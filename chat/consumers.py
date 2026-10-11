import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import User
from django.utils import timezone

from .models import (
    Conversation,
    Message,
    Notification,
    UserStatus,
)

def get_conversation(user_a, user_b, create=False):
    conversation = (
        Conversation.objects.filter(user1=user_a, user2=user_b).first()
        or Conversation.objects.filter(user1=user_b, user2=user_a).first()
    )

    if not conversation and create:
        conversation = Conversation.objects.create(
            user1=user_a,
            user2=user_b,
        )

    return conversation


def touch_conversation(conversation):
    if conversation:
        conversation.updated_at = timezone.now()
        conversation.save(update_fields=["updated_at"])


def serialize_message(message, conversation_id=None):

    media_url = None

    if getattr(message, "media", None):
        try:
            media_url = message.media.url
        except (ValueError, AttributeError):
            media_url = None

    media_type = getattr(message, "media_type", None)

    if media_url:
        message_type = media_type or "media"
    else:
        message_type = "text"

    created_at = timezone.localtime(message.created_at).isoformat()

    return {
        "id": message.id,
        "message_id": message.id,
        "conversation_id": conversation_id,

        "sender_id": message.sender_id,
        "sender": message.sender.username,

        "receiver_id": message.receiver_id,
        "receiver": message.receiver.username,

        "message": message.content or "",
        "message_type": message_type,

        "media_url": media_url,
        "media_type": media_type,

        "is_delivered": message.is_delivered,
        "is_read": message.is_read,

        "created_at": created_at,
    }


class ChatConsumer(AsyncWebsocketConsumer):

    # -----------------------------------------------------------
    # CONNECT / DISCONNECT
    # -----------------------------------------------------------

    async def connect(self):
        self.user = self.scope.get("user")

        if not self.user or self.user.is_anonymous:
            await self.close()
            return

        url_user_id = (
            self.scope
            .get("url_route", {})
            .get("kwargs", {})
            .get("user_id")
        )

        try:
            url_user_id = int(url_user_id)
        except (TypeError, ValueError):
            await self.close()
            return

        if url_user_id != self.user.id:
            await self.close()
            return

        self.user_group_name = f"user_{self.user.id}"

        await self.channel_layer.group_add(
            self.user_group_name,
            self.channel_name,
        )

        await self.accept()

        await self.set_user_online()

        await self.send_json({
            "type": "connection",
            "message": "WebSocket connected successfully.",
            "user_id": self.user.id,
        })

    async def disconnect(self, close_code):
        if hasattr(self, "user_group_name"):
            await self.channel_layer.group_discard(
                self.user_group_name,
                self.channel_name,
            )

        user = getattr(self, "user", None)

        if user and not user.is_anonymous:
            await self.set_user_offline()

    # -----------------------------------------------------------
    # SMALL HELPERS
    # -----------------------------------------------------------

    async def send_json(self, payload):
        await self.send(text_data=json.dumps(payload))

    async def send_error(self, message):
        await self.send_json({
            "type": "error",
            "message": message,
        })

    # -----------------------------------------------------------
    # RECEIVE (browser -> server)
    # -----------------------------------------------------------

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            await self.send_error("Invalid JSON data.")
            return

        if not isinstance(data, dict):
            await self.send_error("Invalid WebSocket data.")
            return

        message_type = data.get("type")

        handlers = {
            "chat_message": self.handle_chat_message,
            "media_message": self.handle_media_message,
            "message_delivered": self.handle_message_delivered,
            "mark_read": self.handle_mark_read,
            "call_offer": self.handle_call_offer,
            "call_answer": self.handle_call_answer,
            "ice_candidate": self.handle_ice_candidate,
            "call_rejected": self.handle_call_rejected,
            "call_ended": self.handle_call_ended,
        }

        handler = handlers.get(message_type)

        if not handler:
            await self.send_error("Unknown WebSocket message type.")
            return

        await handler(data)

    # -----------------------------------------------------------
    # TEXT MESSAGE
    # -----------------------------------------------------------

    async def handle_chat_message(self, data):
        receiver_id = data.get("receiver_id")
        message_text = data.get("message", "")

        if message_text is None:
            message_text = ""

        message_text = str(message_text).strip()

        if not message_text:
            await self.send_error("Message cannot be empty.")
            return

        try:
            receiver_id = int(receiver_id)
        except (TypeError, ValueError):
            await self.send_error("Invalid receiver ID.")
            return

        if receiver_id == self.user.id:
            await self.send_error("You cannot send a message to yourself.")
            return

        message_data = await self.save_text_message(
            receiver_id,
            message_text,
        )

        if not message_data:
            await self.send_error("Unable to save message.")
            return

        # 1) Send to the receiver
        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type": "chat_message",
                **message_data,
            },
        )

        # 2) Send back to the sender (so the sender sees it at once)
        await self.send_json({
            "type": "message_sent",
            **message_data,
        })

    @database_sync_to_async
    def save_text_message(self, receiver_id, message_text):
        try:
            receiver = User.objects.get(id=receiver_id)
        except User.DoesNotExist:
            return None

        if receiver.id == self.user.id:
            return None

        conversation = get_conversation(
            self.user,
            receiver,
            create=True,
        )

        message = Message.objects.create(
            sender=self.user,
            receiver=receiver,
            content=message_text,
            is_delivered=False,
            is_read=False,
        )

        Notification.objects.create(
            user=receiver,
            sender=self.user,
            notification_type="message",
            message=message_text[:255],
        )

        touch_conversation(conversation)

        return serialize_message(message, conversation.id)

    # -----------------------------------------------------------
    # MEDIA MESSAGE
    # -----------------------------------------------------------

    async def handle_media_message(self, data):
        try:
            receiver_id = int(data.get("receiver_id"))
            message_id = int(data.get("message_id"))
        except (TypeError, ValueError):
            await self.send_error("Invalid media message data.")
            return

        if receiver_id == self.user.id:
            await self.send_error("Invalid receiver.")
            return

        message_data = await self.get_media_message(
            message_id,
            receiver_id,
        )

        if not message_data:
            await self.send_error("Media message not found.")
            return

        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type": "media_message",
                **message_data,
            },
        )

        await self.send_json({
            "type": "media_sent",
            **message_data,
        })

    @database_sync_to_async
    def get_media_message(self, message_id, receiver_id):
        try:
            message = Message.objects.select_related(
                "sender",
                "receiver",
            ).get(
                id=message_id,
                sender=self.user,
                receiver_id=receiver_id,
            )
        except Message.DoesNotExist:
            return None

        conversation = get_conversation(self.user, message.receiver)
        touch_conversation(conversation)

        return serialize_message(
            message,
            conversation.id if conversation else None,
        )

    # -----------------------------------------------------------
    # DELIVERED / READ
    # -----------------------------------------------------------

    async def handle_message_delivered(self, data):
        try:
            message_id = int(data.get("message_id"))
        except (TypeError, ValueError):
            return

        result = await self.mark_message_delivered(message_id)

        if not result:
            return

        await self.channel_layer.group_send(
            f"user_{result['sender_id']}",
            {
                "type": "message_delivered",
                "message_id": message_id,
            },
        )

    @database_sync_to_async
    def mark_message_delivered(self, message_id):
        try:
            message = Message.objects.get(id=message_id)
        except Message.DoesNotExist:
            return None

        if message.receiver_id != self.user.id:
            return None

        if not message.is_delivered:
            message.is_delivered = True
            message.delivered_at = timezone.now()
            message.save(update_fields=["is_delivered", "delivered_at"])

        return {"sender_id": message.sender_id}

    async def handle_mark_read(self, data):
        try:
            sender_id = int(data.get("sender_id"))
        except (TypeError, ValueError):
            return

        message_ids = await self.mark_messages_read(sender_id)

        if not message_ids:
            return

        await self.channel_layer.group_send(
            f"user_{sender_id}",
            {
                "type": "messages_read",
                "reader_id": self.user.id,
                "message_ids": message_ids,
            },
        )

    @database_sync_to_async
    def mark_messages_read(self, sender_id):
        messages = Message.objects.filter(
            sender_id=sender_id,
            receiver=self.user,
            is_read=False,
        )

        message_ids = list(messages.values_list("id", flat=True))

        if not message_ids:
            return []

        messages.update(
            is_read=True,
            is_delivered=True,
            read_at=timezone.now(),
        )

        Notification.objects.filter(
            user=self.user,
            sender_id=sender_id,
            notification_type="message",
            is_read=False,
        ).update(is_read=True)

        return message_ids

    # -----------------------------------------------------------
    # ONLINE STATUS
    # -----------------------------------------------------------

    @database_sync_to_async
    def set_user_online(self):
        status, _ = UserStatus.objects.get_or_create(user=self.user)
        status.is_online = True
        status.save(update_fields=["is_online", "updated_at"])

    @database_sync_to_async
    def set_user_offline(self):
        status, _ = UserStatus.objects.get_or_create(user=self.user)
        status.is_online = False
        status.last_seen = timezone.now()
        status.save(
            update_fields=["is_online", "last_seen", "updated_at"]
        )

    @database_sync_to_async
    def user_exists(self, user_id):
        return User.objects.filter(id=user_id).exists()

    # -----------------------------------------------------------
    # VOICE CALLS (browser -> server)
    # -----------------------------------------------------------

    async def handle_call_offer(self, data):
        offer = data.get("offer")

        try:
            receiver_id = int(data.get("receiver_id"))
        except (TypeError, ValueError):
            await self.send_error("Invalid receiver ID.")
            return

        if receiver_id == self.user.id:
            await self.send_error("You cannot call yourself.")
            return

        if not offer:
            await self.send_error("Call offer is missing.")
            return

        if not await self.user_exists(receiver_id):
            await self.send_error("User not found.")
            return

        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type": "call_offer",
                "caller_id": self.user.id,
                "caller_username": self.user.username,
                "offer": offer,
            },
        )

    async def handle_call_answer(self, data):
        caller_id = data.get("caller_id")

        if caller_id is None:
            caller_id = data.get("receiver_id")

        answer = data.get("answer")

        try:
            caller_id = int(caller_id)
        except (TypeError, ValueError):
            await self.send_error("Invalid caller ID in call answer.")
            return

        if caller_id == self.user.id:
            return

        if not answer:
            await self.send_error("Call answer is missing.")
            return

        if not await self.user_exists(caller_id):
            return

        await self.channel_layer.group_send(
            f"user_{caller_id}",
            {
                "type": "call_answer",
                "receiver_id": self.user.id,
                "receiver_username": self.user.username,
                "answer": answer,
            },
        )

    async def handle_ice_candidate(self, data):
        candidate = data.get("candidate")

        try:
            receiver_id = int(data.get("receiver_id"))
        except (TypeError, ValueError):
            return

        if receiver_id == self.user.id or not candidate:
            return

        if not await self.user_exists(receiver_id):
            return

        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type": "ice_candidate",
                "sender_id": self.user.id,
                "candidate": candidate,
            },
        )

    async def handle_call_rejected(self, data):
        # FIX: the browser may send "caller_id" or "receiver_id"
        caller_id = data.get("caller_id")

        if caller_id is None:
            caller_id = data.get("receiver_id")

        try:
            caller_id = int(caller_id)
        except (TypeError, ValueError):
            return

        if caller_id == self.user.id:
            return

        if not await self.user_exists(caller_id):
            return

        await self.channel_layer.group_send(
            f"user_{caller_id}",
            {
                "type": "call_rejected",
                "receiver_id": self.user.id,
                "receiver_username": self.user.username,
            },
        )

    async def handle_call_ended(self, data):
        try:
            receiver_id = int(data.get("receiver_id"))
        except (TypeError, ValueError):
            return

        if receiver_id == self.user.id:
            return

        if not await self.user_exists(receiver_id):
            return

        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type": "call_ended",
                "sender_id": self.user.id,
                "sender_username": self.user.username,
            },
        )

    # -----------------------------------------------------------
    # CHANNEL LAYER EVENTS (server -> browser)
    # -----------------------------------------------------------

    async def chat_message(self, event):
        await self.send_json(event)

        # Ask this browser to confirm delivery
        await self.send_json({
            "type": "request_delivery_ack",
            "message_id": event["message_id"],
            "sender_id": event["sender_id"],
        })

    async def media_message(self, event):
        await self.send_json(event)

        await self.send_json({
            "type": "request_delivery_ack",
            "message_id": event["message_id"],
            "sender_id": event["sender_id"],
        })

    async def message_delivered(self, event):
        await self.send_json({
            "type": "message_delivered",
            "message_id": event["message_id"],
        })

    async def messages_read(self, event):
        await self.send_json({
            "type": "messages_read",
            "reader_id": event["reader_id"],
            "message_ids": event["message_ids"],
        })

    async def call_offer(self, event):
        await self.send_json({
            "type": "call_offer",
            "caller_id": event["caller_id"],
            "caller_username": event["caller_username"],
            "offer": event["offer"],
        })

    async def call_answer(self, event):
        await self.send_json({
            "type": "call_answer",
            "receiver_id": event["receiver_id"],
            "receiver_username": event["receiver_username"],
            "answer": event["answer"],
        })

    async def ice_candidate(self, event):
        await self.send_json({
            "type": "ice_candidate",
            "sender_id": event["sender_id"],
            "candidate": event["candidate"],
        })

    async def call_rejected(self, event):
        await self.send_json({
            "type": "call_rejected",
            "receiver_id": event["receiver_id"],
            "receiver_username": event["receiver_username"],
        })

    async def call_ended(self, event):
        await self.send_json({
            "type": "call_ended",
            "sender_id": event["sender_id"],
            "sender_username": event["sender_username"],
        })