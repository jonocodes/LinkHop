import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from django.db import models
from django.utils import timezone


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Device(TimestampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, unique=True)
    token_hash = models.CharField(max_length=128, unique=True)
    is_active = models.BooleanField(default=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    platform_label = models.CharField(max_length=100, blank=True)
    app_version = models.CharField(max_length=50, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class EnrollmentToken(TimestampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    label = models.CharField(max_length=200)
    token_hash = models.CharField(max_length=128, unique=True)
    expires_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    used_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_enrollment_tokens",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.label

    @property
    def is_usable(self) -> bool:
        return self.is_active and self.used_at is None and self.expires_at > timezone.now()


class MessageType(models.TextChoices):
    URL = "url", "URL"
    TEXT = "text", "Text"


class MessageStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    RECEIVED = "received", "Received"
    PRESENTED = "presented", "Presented"
    OPENED = "opened", "Opened"
    EXPIRED = "expired", "Expired"


class Message(TimestampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sender_device = models.ForeignKey(
        Device,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sent_messages",
    )
    recipient_device = models.ForeignKey(
        Device,
        on_delete=models.CASCADE,
        related_name="incoming_messages",
    )
    type = models.CharField(max_length=10, choices=MessageType.choices)
    body = models.TextField()
    status = models.CharField(
        max_length=20,
        choices=MessageStatus.choices,
        default=MessageStatus.QUEUED,
    )
    received_at = models.DateTimeField(null=True, blank=True)
    presented_at = models.DateTimeField(null=True, blank=True)
    opened_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.type}:{self.id}"

    def clean(self) -> None:
        super().clean()

        if self.type not in MessageType.values:
            raise ValidationError({"type": "Unsupported message type."})

        if self.type == MessageType.URL:
            validator = URLValidator(schemes=["http", "https"])
            if len(self.body) > settings.LINKHOP_MESSAGE_URL_MAX_LENGTH:
                raise ValidationError(
                    {
                        "body": (
                            f"URL must be <= {settings.LINKHOP_MESSAGE_URL_MAX_LENGTH} characters."
                        )
                    }
                )
            try:
                validator(self.body)
            except ValidationError as exc:
                raise ValidationError(
                    {"body": "Must be a valid absolute http or https URL."}
                ) from exc

        if self.type == MessageType.TEXT:
            if not self.body.strip():
                raise ValidationError({"body": "Text messages cannot be blank."})
            if len(self.body) > settings.LINKHOP_MESSAGE_TEXT_MAX_LENGTH:
                raise ValidationError(
                    {
                        "body": (
                            "Text must be <= "
                            f"{settings.LINKHOP_MESSAGE_TEXT_MAX_LENGTH} characters."
                        )
                    }
                )

    @classmethod
    def default_expiry(cls):
        return timezone.now() + timedelta(days=settings.LINKHOP_MESSAGE_RETENTION_DAYS)

    @property
    def is_expired(self) -> bool:
        return self.expires_at <= timezone.now()


class Event(TimestampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=100)
    device = models.ForeignKey(
        Device,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    message = models.ForeignKey(
        Message,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    metadata_json = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.event_type


class GlobalSettings(TimestampedModel):
    singleton_key = models.CharField(max_length=32, default="default", unique=True)
    message_retention_days = models.PositiveIntegerField(
        default=settings.LINKHOP_MESSAGE_RETENTION_DAYS
    )
    enrollment_token_ttl_hours = models.PositiveIntegerField(
        default=settings.LINKHOP_ENROLLMENT_TOKEN_TTL_HOURS
    )
    api_sends_per_minute = models.PositiveIntegerField(
        default=settings.LINKHOP_API_SENDS_PER_MINUTE
    )
    api_confirmations_per_minute = models.PositiveIntegerField(
        default=settings.LINKHOP_API_CONFIRMATIONS_PER_MINUTE
    )
    api_registrations_per_hour = models.PositiveIntegerField(
        default=settings.LINKHOP_API_REGISTRATIONS_PER_HOUR
    )
    max_sse_streams_per_device = models.PositiveIntegerField(
        default=settings.LINKHOP_MAX_SSE_STREAMS_PER_DEVICE
    )
    max_pending_messages = models.PositiveIntegerField(
        default=settings.LINKHOP_MAX_PENDING_MESSAGES
    )

    def __str__(self) -> str:
        return "Global Settings"
