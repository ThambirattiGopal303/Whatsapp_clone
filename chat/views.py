import json
import os

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.http import require_POST, require_http_methods

from .models import Contact, Conversation, Message, Notification, UserStatus

def time_fields(dt):
    local = timezone.localtime(dt)

    return {
        "created_at": local.isoformat(),
        "time": local.strftime("%I:%M %p"),
    }


def get_or_create_conversation(user1, user2):

    conversation = (
        Conversation.objects.filter(user1=user1, user2=user2).first()
        or Conversation.objects.filter(user1=user2, user2=user1).first()
    )

    if conversation is None:
        conversation = Conversation.objects.create(
            user1=user1,
            user2=user2,
        )

    return conversation


def json_error(message, status=400):
    return JsonResponse(
        {"success": False, "message": message},
        status=status,
    )


def get_media_url(message):
    if not message.media:
        return None

    try:
        return message.media.url
    except ValueError:
        return None


# ---------------------------------------------------------------
# PAGES
# ---------------------------------------------------------------

@login_required
def home(request):
    return render(request, "chat/index.html")


# ---------------------------------------------------------------
# CONTACTS
# ---------------------------------------------------------------

@login_required
def contact_list(request):

    contacts = (
        Contact.objects
        .filter(owner=request.user)
        .select_related("contact_user")
    )

    data = []

    for contact in contacts:

        user = contact.contact_user

        unread_count = Message.objects.filter(
            sender=user,
            receiver=request.user,
            is_read=False,
        ).count()

        data.append({
            "id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "nickname": contact.nickname,
            "unread_count": unread_count,
        })

    return JsonResponse({
        "success": True,
        "contacts": data,
    })


@login_required
@require_POST
def add_contact(request):

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return json_error("Invalid JSON data.")

    username = str(data.get("username", "")).strip()

    if not username:
        return json_error("Username is required.")

    try:
        contact_user = User.objects.get(username=username)
    except User.DoesNotExist:
        return json_error("User not found.", 404)

    if contact_user.id == request.user.id:
        return json_error("You cannot add yourself.")

    if Contact.objects.filter(
        owner=request.user,
        contact_user=contact_user,
    ).exists():
        return json_error("This contact is already added.")

    contact = Contact.objects.create(
        owner=request.user,
        contact_user=contact_user,
        nickname="",
    )

    return JsonResponse({
        "success": True,
        "message": "Contact added successfully.",
        "contact": {
            "id": contact_user.id,
            "username": contact_user.username,
            "first_name": contact_user.first_name,
            "last_name": contact_user.last_name,
            "nickname": contact.nickname,
        },
    })


@login_required
@require_http_methods(["POST", "DELETE"])
def delete_contact(request):

    user_id = request.POST.get("user_id")

    if not user_id and request.body:
        try:
            data = json.loads(request.body)
            user_id = data.get("user_id")
        except json.JSONDecodeError:
            user_id = None

    if not user_id:
        return json_error("User ID is required.")

    deleted_count, _ = Contact.objects.filter(
        owner=request.user,
        contact_user_id=user_id,
    ).delete()

    if deleted_count == 0:
        return json_error("Contact not found.", 404)

    return JsonResponse({
        "success": True,
        "message": "Contact deleted successfully.",
    })


@login_required
def search_users(request):

    search = request.GET.get("search", "").strip()

    if not search:
        return JsonResponse({"success": True, "users": []})

    users = (
        User.objects
        .filter(username__icontains=search)
        .exclude(id=request.user.id)
        .order_by("username")[:20]
    )

    data = [
        {
            "id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
        }
        for user in users
    ]

    return JsonResponse({"success": True, "users": data})


# ---------------------------------------------------------------
# MESSAGES
# ---------------------------------------------------------------

@login_required
def message_history(request, user_id):

    try:
        other_user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return json_error("User not found.", 404)

    messages = (
        Message.objects
        .filter(
            Q(sender=request.user, receiver=other_user)
            | Q(sender=other_user, receiver=request.user)
        )
        .select_related("sender", "receiver")
        .order_by("created_at")
    )

    data = []

    for message in messages:

        data.append({
            "id": message.id,

            "sender_id": message.sender.id,
            "sender": message.sender.username,

            "receiver_id": message.receiver.id,
            "receiver": message.receiver.username,

            "message": message.content or "",
            "content": message.content or "",

            "message_type": message.media_type or "text",

            "media_url": get_media_url(message),
            "media_type": message.media_type,

            "is_delivered": message.is_delivered,
            "is_read": message.is_read,

            **time_fields(message.created_at),
        })

    return JsonResponse({
        "success": True,
        "messages": data,
    })


@login_required
@require_POST
def send_message(request):

    receiver_id = request.POST.get("receiver_id")

    if not receiver_id:
        return json_error("Receiver ID is required.")

    message_text = request.POST.get("message", "").strip()

    if not message_text:
        return json_error("Message cannot be empty.")

    try:
        receiver = User.objects.get(id=receiver_id)
    except User.DoesNotExist:
        return json_error("Receiver not found.", 404)

    if receiver.id == request.user.id:
        return json_error("You cannot send a message to yourself.")

    conversation = get_or_create_conversation(request.user, receiver)

    message = Message.objects.create(
        sender=request.user,
        receiver=receiver,
        content=message_text,
        is_delivered=False,
        is_read=False,
    )

    Notification.objects.create(
        user=receiver,
        sender=request.user,
        notification_type="message",
        message=message_text[:255],
    )

    return JsonResponse({
        "success": True,
        "message": {
            "id": message.id,
            "conversation_id": conversation.id,

            "sender_id": request.user.id,
            "sender": request.user.username,

            "receiver_id": receiver.id,
            "receiver": receiver.username,

            "message": message.content,
            "content": message.content,

            "message_type": "text",

            "media_url": None,
            "media_type": None,

            "is_delivered": message.is_delivered,
            "is_read": message.is_read,

            **time_fields(message.created_at),
        },
    })


@login_required
@require_POST
def upload_media(request):

    receiver_id = request.POST.get("receiver_id")

    if not receiver_id:
        return json_error("Receiver is required.")

    uploaded_file = request.FILES.get("file")

    if not uploaded_file:
        return json_error("No file selected.")

    try:
        receiver = User.objects.get(id=receiver_id)
    except User.DoesNotExist:
        return json_error("User not found.", 404)

    if receiver.id == request.user.id:
        return json_error("You cannot send media to yourself.")

    content_type = (uploaded_file.content_type or "").lower()

    if content_type.startswith("image/"):
        media_type = "image"
    elif content_type.startswith("video/"):
        media_type = "video"
    else:
        return json_error("Only images and videos are allowed.")

    if uploaded_file.size > 50 * 1024 * 1024:
        return json_error("Maximum file size is 50 MB.")

    conversation = get_or_create_conversation(request.user, receiver)

    message = Message.objects.create(
        sender=request.user,
        receiver=receiver,
        content="",
        media=uploaded_file,
        media_type=media_type,
        is_delivered=False,
        is_read=False,
    )

    Notification.objects.create(
        user=receiver,
        sender=request.user,
        notification_type="message",
        message="📷 Photo" if media_type == "image" else "🎥 Video",
    )

    return JsonResponse({
        "success": True,

        "message_id": message.id,
        "conversation_id": conversation.id,

        "sender_id": request.user.id,
        "receiver_id": receiver.id,

        "message": "",
        "content": "",

        "message_type": media_type,

        "media_url": get_media_url(message),
        "media_type": media_type,

        "file_name": os.path.basename(message.media.name),

        "is_delivered": message.is_delivered,
        "is_read": message.is_read,

        **time_fields(message.created_at),
    })


@login_required
@require_POST
def mark_messages_read(request):

    sender_id = request.POST.get("sender_id")

    if not sender_id:
        return json_error("Sender ID is required.")

    updated = Message.objects.filter(
        sender_id=sender_id,
        receiver=request.user,
        is_read=False,
    ).update(
        is_read=True,
        is_delivered=True,
    )

    Notification.objects.filter(
        user=request.user,
        sender_id=sender_id,
        notification_type="message",
        is_read=False,
    ).update(is_read=True)

    return JsonResponse({
        "success": True,
        "updated_messages": updated,
    })


# ---------------------------------------------------------------
# NOTIFICATIONS
# ---------------------------------------------------------------

@login_required
def notifications(request):

    notification_list = (
        Notification.objects
        .filter(user=request.user)
        .select_related("sender")
        .order_by("-created_at")[:50]
    )

    unread_count = Notification.objects.filter(
        user=request.user,
        is_read=False,
    ).count()

    data = []

    for notification in notification_list:

        data.append({
            "id": notification.id,

            "sender_id": notification.sender.id,
            "sender": notification.sender.username,

            "type": notification.notification_type,
            "message": notification.message,
            "is_read": notification.is_read,

            **time_fields(notification.created_at),
        })

    return JsonResponse({
        "success": True,
        "unread_count": unread_count,
        "notifications": data,
    })


# ---------------------------------------------------------------
# PRESENCE
# ---------------------------------------------------------------

@login_required
def user_presence(request, user_id):

    try:
        status = UserStatus.objects.get(user_id=user_id)
    except UserStatus.DoesNotExist:
        return JsonResponse({
            "success": True,
            "user_id": user_id,
            "is_online": False,
            "last_seen": None,
        })

    return JsonResponse({
        "success": True,
        "user_id": user_id,
        "is_online": status.is_online,
        "last_seen": (
            timezone.localtime(status.last_seen).isoformat()
            if status.last_seen
            else None
        ),
    })