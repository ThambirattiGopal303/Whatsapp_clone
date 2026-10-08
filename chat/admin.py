from django.contrib import admin
from .models import Message

from .models import Contact,Conversation,Message,Notification,CallRecord


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):

    list_display = (
        "owner",
        "contact_user",
        "nickname",
        "created_at",
    )

    search_fields = (
        "owner__username",
        "contact_user__username",
        "nickname",
    )


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):

    list_display = (
        "user1",
        "user2",
        "created_at",
        "updated_at",
    )

    search_fields = (
        "user1__username",
        "user2__username",
    )



@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):

    list_display = (
        "id",
    )

    search_fields = (
        "id",
    )

    ordering = (
        "-id",
    )
@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):

    list_display = (
        "user",
        "sender",
        "notification_type",
        "is_read",
        "created_at",
    )

    list_filter = (
        "notification_type",
        "is_read",
    )


@admin.register(CallRecord)
class CallRecordAdmin(admin.ModelAdmin):

    list_display = (
        "caller",
        "receiver",
        "call_type",
        "status",
        "started_at",
        "duration",
    )

    list_filter = (
        "call_type",
        "status",
    )

    search_fields = (
        "caller__username",
        "receiver__username",
    )