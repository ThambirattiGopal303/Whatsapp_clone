import json
import os

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_POST, require_http_methods

from .models import Contact,Conversation,Message,Notification,UserStatus



@login_required
def home(request):
    return render(request, "chat/index.html")

def get_or_create_conversation(user1, user2):

    conversation = Conversation.objects.filter(
        user1=user1,
        user2=user2
    ).first()

    if conversation is None:
        conversation = Conversation.objects.filter(
            user1=user2,
            user2=user1
        ).first()

    if conversation is None:
        conversation = Conversation.objects.create(
            user1=user1,
            user2=user2
        )

    return conversation


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
            is_read=False
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
        "contacts": data
    })

@login_required
@require_POST
def add_contact(request):

    try:
        data = json.loads(request.body or "{}")

    except json.JSONDecodeError:

        return JsonResponse({
            "success": False,
            "message": "Invalid JSON data."
        }, status=400)

    username = str(
        data.get("username", "")
    ).strip()

    if not username:

        return JsonResponse({
            "success": False,
            "message": "Username is required."
        }, status=400)


    try:

        contact_user = User.objects.get(
            username=username
        )

    except User.DoesNotExist:

        return JsonResponse({
            "success": False,
            "message": "User not found."
        }, status=404)

    if contact_user.id == request.user.id:

        return JsonResponse({
            "success": False,
            "message": "You cannot add yourself."
        }, status=400)

    existing_contact = Contact.objects.filter(
        owner=request.user,
        contact_user=contact_user
    ).first()

    if existing_contact:

        return JsonResponse({
            "success": False,
            "message": "This contact is already added."
        }, status=400)

    contact = Contact.objects.create(
        owner=request.user,
        contact_user=contact_user,
        nickname=""
    )

    return JsonResponse({

        "success": True,

        "message": "Contact added successfully.",

        "contact": {

            "id": contact_user.id,

            "username": contact_user.username,

            "first_name": contact_user.first_name,

            "last_name": contact_user.last_name,

            "nickname": contact.nickname
        }
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

        return JsonResponse({
            "success": False,
            "message": "User ID is required."
        }, status=400)

    deleted_count, _ = Contact.objects.filter(
        owner=request.user,
        contact_user_id=user_id
    ).delete()

    if deleted_count == 0:

        return JsonResponse({
            "success": False,
            "message": "Contact not found."
        }, status=404)

    return JsonResponse({
        "success": True,
        "message": "Contact deleted successfully."
    })

@login_required
def search_users(request):

    search = request.GET.get(
        "search",
        ""
    ).strip()

    if not search:

        return JsonResponse({
            "success": True,
            "users": []
        })

    users = (
        User.objects
        .filter(
            username__icontains=search
        )
        .exclude(
            id=request.user.id
        )
        .order_by("username")[:20]
    )

    data = []

    for user in users:

        data.append({

            "id": user.id,

            "username": user.username,

            "first_name": user.first_name,

            "last_name": user.last_name,
        })

    return JsonResponse({

        "success": True,

        "users": data
    })

@login_required
def message_history(request, user_id):

    try:

        other_user = User.objects.get(
            id=user_id
        )

    except User.DoesNotExist:

        return JsonResponse({

            "success": False,

            "message": "User not found."

        }, status=404)
    
    messages = Message.objects.filter(

        sender=request.user,
        receiver=other_user

    ) | Message.objects.filter(

        sender=other_user,
        receiver=request.user

    )

    messages = messages.select_related(
        "sender",
        "receiver"
    ).order_by("created_at")

    data = []

    for message in messages:

        media_url = None

        if message.media:

            try:

                media_url = message.media.url

            except ValueError:

                media_url = None

        # Determine message type
        if message.media_type:
            message_type = message.media_type
        else:
            message_type = "text"

        data.append({

            "id": message.id,

            "sender_id": message.sender.id,

            "sender": message.sender.username,

            "receiver_id": message.receiver.id,

            "receiver": message.receiver.username,

            "message": message.content or "",

            "content": message.content or "",

            "message_type": message_type,

            "media_url": media_url,

            "media_type": message.media_type,

            "is_delivered": message.is_delivered,

            "is_read": message.is_read,

            "created_at": message.created_at.strftime(
                "%Y-%m-%d %H:%M:%S"
            ),

            "time": message.created_at.strftime(
                "%I:%M %p"
            ),
        })

    return JsonResponse({

        "success": True,

        "messages": data
    })

@login_required
@require_POST
def send_message(request):

    receiver_id = request.POST.get(
        "receiver_id"
    )

    if not receiver_id:

        return JsonResponse({

            "success": False,

            "message": "Receiver ID is required."

        }, status=400)

    message_text = request.POST.get(
        "message",
        ""
    ).strip()

    if not message_text:

        return JsonResponse({

            "success": False,

            "message": "Message cannot be empty."

        }, status=400)

    try:

        receiver = User.objects.get(
            id=receiver_id
        )

    except User.DoesNotExist:

        return JsonResponse({

            "success": False,

            "message": "Receiver not found."

        }, status=404)


    if receiver.id == request.user.id:

        return JsonResponse({

            "success": False,

            "message": "You cannot send a message to yourself."

        }, status=400)

    conversation = get_or_create_conversation(
        request.user,
        receiver
    )


    message = Message.objects.create(

        sender=request.user,

        receiver=receiver,

        content=message_text,

        is_delivered=False,

        is_read=False
    )


    Notification.objects.create(

        user=receiver,

        sender=request.user,

        notification_type="message",

        message=message_text[:255]
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

            "created_at": message.created_at.strftime(
                "%Y-%m-%d %H:%M:%S"
            ),

            "time": message.created_at.strftime(
                "%I:%M %p"
            )
        }
    })


@login_required
@require_POST
def upload_media(request):

    receiver_id = request.POST.get(
        "receiver_id"
    )

    if not receiver_id:

        return JsonResponse({

            "success": False,

            "message": "Receiver is required."

        }, status=400)

    uploaded_file = request.FILES.get(
        "file"
    )

    if not uploaded_file:

        return JsonResponse({

            "success": False,

            "message": "No file selected."

        }, status=400)

    try:

        receiver = User.objects.get(
            id=receiver_id
        )

    except User.DoesNotExist:

        return JsonResponse({

            "success": False,

            "message": "User not found."

        }, status=404)


    if receiver.id == request.user.id:

        return JsonResponse({

            "success": False,

            "message": "You cannot send media to yourself."

        }, status=400)

    content_type = (
        uploaded_file.content_type or ""
    ).lower()

    if content_type.startswith("image/"):

        media_type = "image"

    elif content_type.startswith("video/"):

        media_type = "video"

    else:

        return JsonResponse({

            "success": False,

            "message": "Only images and videos are allowed."

        }, status=400)


    if uploaded_file.size > 50 * 1024 * 1024:

        return JsonResponse({

            "success": False,

            "message": "Maximum file size is 50 MB."

        }, status=400)

    conversation = get_or_create_conversation(
        request.user,
        receiver
    )

    message = Message.objects.create(

        sender=request.user,

        receiver=receiver,

        content="",

        media=uploaded_file,

        media_type=media_type,

        is_delivered=False,

        is_read=False
    )

 

    if media_type == "image":

        notification_text = "📷 Photo"

    else:

        notification_text = "🎥 Video"
    Notification.objects.create(

        user=receiver,

        sender=request.user,

        notification_type="message",

        message=notification_text
    )

    media_url = None

    if message.media:

        try:

            media_url = message.media.url

        except ValueError:

            media_url = None
    return JsonResponse({

        "success": True,

        "message_id": message.id,

        "conversation_id": conversation.id,

        "sender_id": request.user.id,

        "receiver_id": receiver.id,

        "message": "",

        "content": "",

        "message_type": media_type,

        "media_url": media_url,

        "media_type": media_type,

        "file_name": os.path.basename(
            message.media.name
        ),

        "is_delivered": message.is_delivered,

        "is_read": message.is_read,

        "created_at": message.created_at.strftime(
            "%Y-%m-%d %H:%M:%S"
        ),

        "time": message.created_at.strftime(
            "%I:%M %p"
        )
    })

@login_required
@require_POST
def mark_messages_read(request):

    sender_id = request.POST.get(
        "sender_id"
    )

    if not sender_id:

        return JsonResponse({

            "success": False,

            "message": "Sender ID is required."

        }, status=400)

    updated = Message.objects.filter(

        sender_id=sender_id,

        receiver=request.user,

        is_read=False

    ).update(

        is_read=True
    )

    Notification.objects.filter(

        user=request.user,

        sender_id=sender_id,

        notification_type="message",

        is_read=False

    ).update(

        is_read=True
    )

    return JsonResponse({

        "success": True,

        "updated_messages": updated
    })

@login_required
def notifications(request):

    notification_list = (
        Notification.objects
        .filter(
            user=request.user
        )
        .select_related("sender")
        [:50]
    )

    unread_count = Notification.objects.filter(
        user=request.user,
        is_read=False
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

            "created_at": notification.created_at.strftime(
                "%Y-%m-%d %H:%M:%S"
            ),

            "time": notification.created_at.strftime(
                "%I:%M %p"
            )
        })

    return JsonResponse({

        "success": True,

        "unread_count": unread_count,

        "notifications": data
    })


@login_required
def user_presence(request, user_id):

    try:

        status = UserStatus.objects.get(
            user_id=user_id
        )

        return JsonResponse({

            "success": True,

            "user_id": user_id,

            "is_online": status.is_online,

            "last_seen": (
                status.last_seen.isoformat()
                if status.last_seen
                else None
            ),
        })

    except UserStatus.DoesNotExist:

        return JsonResponse({

            "success": True,

            "user_id": user_id,

            "is_online": False,

            "last_seen": None,
        })