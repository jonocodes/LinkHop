import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class DeviceType(models.TextChoices):
    PWA = "pwa", "PWA"
    BROWSER = "browser", "Browser"
    EXTENSION = "extension", "Extension"
    CLI = "cli", "CLI"
    API = "api", "API"


class Device(TimestampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="devices",
    )
    name = models.CharField(max_length=200)
    token_hash = models.CharField(max_length=128, unique=True)
    is_active = models.BooleanField(default=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    last_push_at = models.DateTimeField(null=True, blank=True)
    device_type = models.CharField(max_length=20, choices=DeviceType.choices, blank=True, default="")
    browser = models.CharField(max_length=100, blank=True, default="")
    os = models.CharField(max_length=100, blank=True, default="")

    @property
    def last_active_at(self):
        """Most recent activity — API request or push delivery."""
        candidates = [t for t in (self.last_seen_at, self.last_push_at) if t is not None]
        return max(candidates) if candidates else None

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "name"],
                name="unique_device_name_per_owner",
            ),
        ]

    def __str__(self) -> str:
        return self.name



class PairingPin(TimestampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code_hash = models.CharField(max_length=128, unique=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="pairing_pins",
    )
    created_by_device = models.ForeignKey(
        Device,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_pairing_pins",
    )
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"pairing-pin:{self.id}"

    @property
    def is_usable(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()


class PushSubscription(TimestampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(
        Device,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    endpoint = models.URLField(unique=True, max_length=1000)
    p256dh = models.CharField(max_length=255)
    auth_secret = models.CharField(max_length=255)
    user_agent = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"push:{self.device.name}"


class MessageType(models.TextChoices):
    URL = "url", "URL"
    TEXT = "text", "Text"


class GlobalSettings(TimestampedModel):
    singleton_key = models.CharField(max_length=32, default="default", unique=True)
    api_sends_per_minute = models.PositiveIntegerField(
        default=settings.LINKHOP_API_SENDS_PER_MINUTE
    )
    api_registrations_per_hour = models.PositiveIntegerField(
        default=settings.LINKHOP_API_REGISTRATIONS_PER_HOUR
    )
    allow_self_send = models.BooleanField(
        default=False,
        help_text="Allow a device to send a message to itself.",
    )

    def __str__(self) -> str:
        return "Global Settings"
