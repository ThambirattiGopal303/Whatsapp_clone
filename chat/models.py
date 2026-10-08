from django.contrib.auth.models import User
from django.db import models



class Contact(models.Model):

    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="contacts"
    )

    contact_user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="added_by_users"
    )

    nickname = models.CharField(
        max_length=100,
        blank=True
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    class Meta:
        unique_together = (
            "owner",
            "contact_user"
        )

        ordering = [
            "-created_at"
        ]

    def __str__(self):
        return (
            f"{self.owner.username} -> "
            f"{self.contact_user.username}"
        )


class Conversation(models.Model):

    user1 = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="conversations_as_user1"
    )

    user2 = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="conversations_as_user2"
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    updated_at = models.DateTimeField(
        auto_now=True
    )

    class Meta:
        ordering = [
            "-updated_at"
        ]

    def __str__(self):
        return (
            f"{self.user1.username} - "
            f"{self.user2.username}"
        )



class Message(models.Model):

    sender = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="sent_messages"
    )

    receiver = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="received_messages"
    )

    content = models.TextField(
        blank=True,
        null=True
    )


    media = models.FileField(
        upload_to="chat_media/",
        blank=True,
        null=True
    )

    media_type = models.CharField(
        max_length=20,
        blank=True,
        null=True
    )
    is_delivered = models.BooleanField(
        default=False
    )

    delivered_at = models.DateTimeField(
        null=True,
        blank=True
    )


    is_read = models.BooleanField(
        default=False
    )

    read_at = models.DateTimeField(
        null=True,
        blank=True
    )


    created_at = models.DateTimeField(
        auto_now_add=True
    )


    class Meta:
        ordering = [
            "created_at"
        ]


    def __str__(self):

        if self.content:
            return (
                f"{self.sender.username}: "
                f"{self.content[:30]}"
            )

        if self.media:
            return (
                f"{self.sender.username}: "
                f"{self.media_type}"
            )

        return (
            f"{self.sender.username} -> "
            f"{self.receiver.username}"
        )



class Notification(models.Model):

    NOTIFICATION_TYPES = [

        ("message", "Message"),

        ("call", "Call"),

        ("contact", "Contact"),

    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="notifications"
    )

    sender = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="sent_notifications"
    )

    notification_type = models.CharField(
        max_length=20,
        choices=NOTIFICATION_TYPES,
        default="message"
    )

    message = models.CharField(
        max_length=255
    )

    is_read = models.BooleanField(
        default=False
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    class Meta:
        ordering = [
            "-created_at"
        ]

    def __str__(self):
        return (
            f"{self.user.username} - "
            f"{self.message}"
        )

class CallRecord(models.Model):

    CALL_TYPES = [

        ("voice", "Voice"),

    ]

    CALL_STATUS = [

        ("calling", "Calling"),

        ("accepted", "Accepted"),

        ("rejected", "Rejected"),

        ("missed", "Missed"),

        ("ended", "Ended"),

    ]

    caller = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="calls_made"
    )

    receiver = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="calls_received"
    )

    call_type = models.CharField(
        max_length=20,
        choices=CALL_TYPES,
        default="voice"
    )

    status = models.CharField(
        max_length=20,
        choices=CALL_STATUS,
        default="calling"
    )

    started_at = models.DateTimeField(
        auto_now_add=True
    )

    answered_at = models.DateTimeField(
        null=True,
        blank=True
    )

    ended_at = models.DateTimeField(
        null=True,
        blank=True
    )

    duration = models.PositiveIntegerField(
        default=0,
        help_text="Duration in seconds"
    )

    class Meta:
        ordering = [
            "-started_at"
        ]

    def __str__(self):
        return (
            f"{self.caller.username} -> "
            f"{self.receiver.username} "
            f"({self.status})"
        )

class UserStatus(models.Model):

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="status"
    )

    is_online = models.BooleanField(
        default=False
    )

    last_seen = models.DateTimeField(
        null=True,
        blank=True
    )

    updated_at = models.DateTimeField(
        auto_now=True
    )

    def __str__(self):
        return self.user.username