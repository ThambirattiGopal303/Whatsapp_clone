import json

from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async

from django.contrib.auth.models import User
from django.utils import timezone

from .models import (
    Conversation,
    Message,
    Notification,
    UserStatus,
)


class ChatConsumer(AsyncWebsocketConsumer):

# CONNECT
   

    async def connect(self):

        self.user = self.scope.get("user")

    
 # Authentication
        

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
            self.channel_name
        )

       

        await self.accept()

      

        await self.set_user_online()

       

        await self.send(
            text_data=json.dumps({
                "type": "connection",
                "message": "WebSocket connected successfully.",
                "user_id": self.user.id,
            })
        )

    

    async def disconnect(self, close_code):

        if hasattr(self, "user_group_name"):

            await self.channel_layer.group_discard(
                self.user_group_name,
                self.channel_name
            )

        if hasattr(self, "user"):

            if self.user and not self.user.is_anonymous:

                await self.set_user_offline()

# recive

    async def receive(self, text_data):

        try:
            data = json.loads(text_data)

        except (json.JSONDecodeError, TypeError):

            await self.send_error(
                "Invalid JSON data."
            )

            return

        if not isinstance(data, dict):

            await self.send_error(
                "Invalid WebSocket data."
            )

            return

        message_type = data.get("type")

   # CHAT MESSAGE

        if message_type == "chat_message":

            await self.handle_chat_message(data)
# MEDIA MESSAGE

        elif message_type == "media_message":

            await self.handle_media_message(data)

        elif message_type == "message_delivered":

            await self.handle_message_delivered(data)
        elif message_type == "mark_read":

            await self.handle_mark_read(data)

    
        elif message_type == "call_offer":

            await self.handle_call_offer(data)


        elif message_type == "call_answer":

            await self.handle_call_answer(data)

       
        elif message_type == "ice_candidate":

            await self.handle_ice_candidate(data)


        elif message_type == "call_rejected":

            await self.handle_call_rejected(data)

       

        elif message_type == "call_ended":

            await self.handle_call_ended(data)

        else:

            await self.send_error(
                "Unknown WebSocket message type."
            )

   

    async def handle_chat_message(self, data):

        receiver_id = data.get("receiver_id")
        message_text = data.get("message", "")

        if message_text is None:
            message_text = ""

        message_text = str(message_text).strip()

        if not message_text:

            await self.send_error(
                "Message cannot be empty."
            )

            return

        try:
            receiver_id = int(receiver_id)

        except (TypeError, ValueError):

            await self.send_error(
                "Invalid receiver ID."
            )

            return

        if receiver_id == self.user.id:

            await self.send_error(
                "You cannot send a message to yourself."
            )

            return

        message_data = await self.save_text_message(
            receiver_id,
            message_text
        )

        if not message_data:

            await self.send_error(
                "Unable to save message."
            )

            return

        

        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type": "chat_message",
                **message_data,
            }
        )

       

        await self.send(
            text_data=json.dumps({
                "type": "message_sent",
                **message_data,
            })
        )

   

    @database_sync_to_async
    def save_text_message(
        self,
        receiver_id,
        message_text
    ):

        try:

            receiver = User.objects.get(
                id=receiver_id
            )

        except User.DoesNotExist:

            return None

        if receiver.id == self.user.id:
            return None

      
        conversation = Conversation.objects.filter(
            user1=self.user,
            user2=receiver
        ).first()

        if not conversation:

            conversation = Conversation.objects.filter(
                user1=receiver,
                user2=self.user
            ).first()

        if not conversation:

            conversation = Conversation.objects.create(
                user1=self.user,
                user2=receiver
            )


        message = Message.objects.create(
            sender=self.user,
            receiver=receiver,
            content=message_text,
            is_delivered=False,
            is_read=False
        )

        Notification.objects.create(
            user=receiver,
            sender=self.user,
            notification_type="message",
            message=message_text[:255]
        )

      
        conversation.updated_at = timezone.now()

        conversation.save(
            update_fields=["updated_at"]
        )

    

        created_at = timezone.localtime(
            message.created_at
        ).isoformat()

        return {
            "message_id": message.id,
            "conversation_id": conversation.id,

            "sender_id": self.user.id,
            "sender": self.user.username,

            "receiver_id": receiver.id,
            "receiver": receiver.username,

            "message": message.content or "",
            "message_type": "text",

            "is_delivered": message.is_delivered,
            "is_read": message.is_read,

            "media_url": None,
            "media_type": None,

            "created_at": created_at,
        }

    async def handle_media_message(self, data):

        receiver_id = data.get("receiver_id")
        message_id = data.get("message_id")

        try:

            receiver_id = int(receiver_id)
            message_id = int(message_id)

        except (TypeError, ValueError):

            await self.send_error(
                "Invalid media message data."
            )

            return

        if receiver_id == self.user.id:

            await self.send_error(
                "Invalid receiver."
            )

            return

        message_data = await self.get_media_message(
            message_id,
            receiver_id
        )

        if not message_data:

            await self.send_error(
                "Media message not found."
            )

            return

        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type": "media_message",
                **message_data,
            }
        )

        await self.send(
            text_data=json.dumps({
                "type": "media_sent",
                **message_data,
            })
        )

    @database_sync_to_async
    def get_media_message(
        self,
        message_id,
        receiver_id
    ):

        try:

            message = Message.objects.select_related(
                "sender",
                "receiver"
            ).get(
                id=message_id,
                sender=self.user,
                receiver_id=receiver_id
            )

        except Message.DoesNotExist:

            return None

        media_url = None

        if message.media:

            try:
                media_url = message.media.url

            except (ValueError, AttributeError):
                media_url = None

        conversation = Conversation.objects.filter(
            user1=self.user,
            user2=message.receiver
        ).first()

        if not conversation:

            conversation = Conversation.objects.filter(
                user1=message.receiver,
                user2=self.user
            ).first()

        if conversation:

            conversation.updated_at = timezone.now()

            conversation.save(
                update_fields=["updated_at"]
            )

        created_at = timezone.localtime(
            message.created_at
        ).isoformat()

        return {
            "message_id": message.id,

            "conversation_id":
                conversation.id
                if conversation
                else None,

            "sender_id":
                message.sender_id,

            "sender":
                message.sender.username,

            "receiver_id":
                message.receiver_id,

            "receiver":
                message.receiver.username,

            "message":
                message.content or "",

            "message_type":
                message.media_type or "media",

            "media_url":
                media_url,

            "media_type":
                message.media_type,

            "is_delivered":
                message.is_delivered,

            "is_read":
                message.is_read,

            "created_at":
                created_at,
        }

    async def media_message(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "media_message",

                "message_id":
                    event["message_id"],

                "conversation_id":
                    event.get("conversation_id"),

                "sender_id":
                    event["sender_id"],

                "sender":
                    event["sender"],

                "receiver_id":
                    event["receiver_id"],

                "receiver":
                    event["receiver"],

                "message":
                    event.get("message", ""),

                "message_type":
                    event.get(
                        "message_type",
                        "media"
                    ),

                "media_url":
                    event.get("media_url"),

                "media_type":
                    event.get("media_type"),

                "is_delivered":
                    event.get(
                        "is_delivered",
                        False
                    ),

                "is_read":
                    event.get(
                        "is_read",
                        False
                    ),

                "created_at":
                    event["created_at"],
            })
        )

        await self.send(
            text_data=json.dumps({

                "type":
                    "request_delivery_ack",

                "message_id":
                    event["message_id"],

                "sender_id":
                    event["sender_id"],
            })
        )
    async def handle_message_delivered(self, data):

        message_id = data.get("message_id")

        try:
            message_id = int(message_id)

        except (TypeError, ValueError):

            return

        result = await self.mark_message_delivered(
            message_id
        )

        if not result:
            return

        sender_id = result["sender_id"]

        await self.channel_layer.group_send(
            f"user_{sender_id}",
            {
                "type": "message_delivered",
                "message_id": message_id,
            }
        )

    @database_sync_to_async
    def mark_message_delivered(self, message_id):

        try:

            message = Message.objects.get(
                id=message_id
            )

        except Message.DoesNotExist:

            return None

        if message.receiver_id != self.user.id:
            return None

        if message.is_delivered:

            return {
                "sender_id":
                    message.sender_id
            }

        message.is_delivered = True
        message.delivered_at = timezone.now()

        message.save(
            update_fields=[
                "is_delivered",
                "delivered_at"
            ]
        )

        return {
            "sender_id":
                message.sender_id
        }


    async def handle_mark_read(self, data):

        sender_id = data.get("sender_id")

        try:
            sender_id = int(sender_id)

        except (TypeError, ValueError):

            return

        message_ids = await self.mark_messages_read(
            sender_id
        )

        if not message_ids:
            return

        await self.channel_layer.group_send(
            f"user_{sender_id}",
            {
                "type": "messages_read",

                "reader_id":
                    self.user.id,

                "message_ids":
                    message_ids,
            }
        )

   
    @database_sync_to_async
    def mark_messages_read(self, sender_id):

        messages = Message.objects.filter(
            sender_id=sender_id,
            receiver=self.user,
            is_read=False
        )

        message_ids = list(
            messages.values_list(
                "id",
                flat=True
            )
        )

        if not message_ids:
            return []

        messages.update(
            is_read=True,
            read_at=timezone.now()
        )

        Notification.objects.filter(
            user=self.user,
            sender_id=sender_id,
            notification_type="message",
            is_read=False
        ).update(
            is_read=True
        )

        return message_ids


    @database_sync_to_async
    def set_user_online(self):

        status, created = (
            UserStatus.objects.get_or_create(
                user=self.user
            )
        )

        status.is_online = True

        status.save(
            update_fields=[
                "is_online",
                "updated_at"
            ]
        )

    
    @database_sync_to_async
    def set_user_offline(self):

        status, created = (
            UserStatus.objects.get_or_create(
                user=self.user
            )
        )

        status.is_online = False
        status.last_seen = timezone.now()

        status.save(
            update_fields=[
                "is_online",
                "last_seen",
                "updated_at"
            ]
        )


    @database_sync_to_async
    def user_exists(self, user_id):

        return User.objects.filter(
            id=user_id
        ).exists()

   
    async def handle_call_offer(self, data):

        receiver_id = data.get("receiver_id")
        offer = data.get("offer")

        try:
            receiver_id = int(receiver_id)

        except (TypeError, ValueError):

            await self.send_error(
                "Invalid receiver ID."
            )

            return

        if receiver_id == self.user.id:

            await self.send_error(
                "You cannot call yourself."
            )

            return

        if not offer:

            await self.send_error(
                "Call offer is missing."
            )

            return

        exists = await self.user_exists(
            receiver_id
        )

        if not exists:

            await self.send_error(
                "User not found."
            )

            return

    
        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type": "call_offer",

                "caller_id":
                    self.user.id,

                "caller_username":
                    self.user.username,

                "offer":
                    offer,
            }
        )

    async def handle_call_answer(self, data):


        caller_id = data.get("caller_id")

        if caller_id is None:
            caller_id = data.get("receiver_id")

        answer = data.get("answer")

        try:
            caller_id = int(caller_id)

        except (TypeError, ValueError):

            await self.send_error(
                "Invalid caller ID in call answer."
            )

            return

        if caller_id == self.user.id:
            return

        if not answer:
            await self.send_error(
                "Call answer is missing."
            )
            return

        exists = await self.user_exists(
            caller_id
        )

        if not exists:
            return

       
        await self.channel_layer.group_send(
            f"user_{caller_id}",
            {
                "type":
                    "call_answer",

                "receiver_id":
                    self.user.id,

                "receiver_username":
                    self.user.username,

                "answer":
                    answer,
            }
        )

  
    async def handle_ice_candidate(self, data):

        receiver_id = data.get("receiver_id")
        candidate = data.get("candidate")

        try:
            receiver_id = int(receiver_id)

        except (TypeError, ValueError):

            return

        if receiver_id == self.user.id:
            return

        if not candidate:
            return

        exists = await self.user_exists(
            receiver_id
        )

        if not exists:
            return

  
        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type":
                    "ice_candidate",

                "sender_id":
                    self.user.id,

                "candidate":
                    candidate,
            }
        )

 

    async def handle_call_rejected(self, data):

        caller_id = data.get("caller_id")

        try:
            caller_id = int(caller_id)

        except (TypeError, ValueError):

            return

        if caller_id == self.user.id:
            return

        exists = await self.user_exists(
            caller_id
        )

        if not exists:
            return

        await self.channel_layer.group_send(
            f"user_{caller_id}",
            {
                "type":
                    "call_rejected",

                "receiver_id":
                    self.user.id,

                "receiver_username":
                    self.user.username,
            }
        )



    async def handle_call_ended(self, data):

        receiver_id = data.get("receiver_id")

        try:
            receiver_id = int(receiver_id)

        except (TypeError, ValueError):

            return

        if receiver_id == self.user.id:
            return

        exists = await self.user_exists(
            receiver_id
        )

        if not exists:
            return

        await self.channel_layer.group_send(
            f"user_{receiver_id}",
            {
                "type":
                    "call_ended",

                "sender_id":
                    self.user.id,

                "sender_username":
                    self.user.username,
            }
        )

   
    async def chat_message(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "chat_message",

                "message_id":
                    event["message_id"],

                "conversation_id":
                    event["conversation_id"],

                "sender_id":
                    event["sender_id"],

                "sender":
                    event["sender"],

                "receiver_id":
                    event["receiver_id"],

                "receiver":
                    event["receiver"],

                "message":
                    event["message"],

                "message_type":
                    event["message_type"],

                "is_delivered":
                    event["is_delivered"],

                "is_read":
                    event["is_read"],

                "media_url":
                    event.get("media_url"),

                "media_type":
                    event.get("media_type"),

                "created_at":
                    event["created_at"],
            })
        )


        await self.send(
            text_data=json.dumps({

                "type":
                    "request_delivery_ack",

                "message_id":
                    event["message_id"],

                "sender_id":
                    event["sender_id"],
            })
        )

  

    async def media_message(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "media_message",

                "message_id":
                    event["message_id"],

                "conversation_id":
                    event.get(
                        "conversation_id"
                    ),

                "sender_id":
                    event["sender_id"],

                "sender":
                    event["sender"],

                "receiver_id":
                    event["receiver_id"],

                "receiver":
                    event["receiver"],

                "message":
                    event.get(
                        "message",
                        ""
                    ),

                "message_type":
                    event.get(
                        "message_type",
                        "media"
                    ),

                "media_url":
                    event.get(
                        "media_url"
                    ),

                "media_type":
                    event.get(
                        "media_type"
                    ),

                "is_delivered":
                    event.get(
                        "is_delivered",
                        False
                    ),

                "is_read":
                    event.get(
                        "is_read",
                        False
                    ),

                "created_at":
                    event["created_at"],
            })
        )

        await self.send(
            text_data=json.dumps({

                "type":
                    "request_delivery_ack",

                "message_id":
                    event["message_id"],

                "sender_id":
                    event["sender_id"],
            })
        )

  

    async def message_delivered(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "message_delivered",

                "message_id":
                    event["message_id"],
            })
        )

  

    async def messages_read(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "messages_read",

                "reader_id":
                    event["reader_id"],

                "message_ids":
                    event["message_ids"],
            })
        )


    async def call_offer(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "call_offer",

                "caller_id":
                    event["caller_id"],

                "caller_username":
                    event["caller_username"],

                "offer":
                    event["offer"],
            })
        )

    async def call_answer(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "call_answer",

                "receiver_id":
                    event["receiver_id"],

                "receiver_username":
                    event["receiver_username"],

                "answer":
                    event["answer"],
            })
        )

    async def ice_candidate(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "ice_candidate",

                "sender_id":
                    event["sender_id"],

                "candidate":
                    event["candidate"],
            })
        )

    async def call_rejected(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "call_rejected",

                "receiver_id":
                    event["receiver_id"],

                "receiver_username":
                    event["receiver_username"],
            })
        )



    async def call_ended(self, event):

        await self.send(
            text_data=json.dumps({

                "type":
                    "call_ended",

                "sender_id":
                    event["sender_id"],

                "sender_username":
                    event["sender_username"],
            })
        )



    async def send_error(self, message):

        await self.send(
            text_data=json.dumps({

                "type":
                    "error",

                "message":
                    message,
            })
        )