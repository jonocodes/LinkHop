import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from core.models import Device, EnrollmentToken


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def create_enrollment_token(*, label: str, created_by=None) -> tuple[EnrollmentToken, str]:
    raw_token = generate_token("enroll")
    token = EnrollmentToken.objects.create(
        label=label,
        token_hash=hash_token(raw_token),
        expires_at=timezone.now() + timedelta(hours=settings.LINKHOP_ENROLLMENT_TOKEN_TTL_HOURS),
        created_by=created_by,
    )
    return token, raw_token


def consume_enrollment_token(raw_token: str) -> EnrollmentToken | None:
    token_hash = hash_token(raw_token)
    try:
        token = EnrollmentToken.objects.get(token_hash=token_hash)
    except EnrollmentToken.DoesNotExist:
        return None

    if not token.is_usable:
        return None

    token.used_at = timezone.now()
    token.save(update_fields=["used_at", "updated_at"])
    return token


def create_device_token(
    *,
    name: str,
    platform_label: str = "",
    app_version: str = "",
) -> tuple[Device, str]:
    raw_token = generate_token("device")
    device = Device.objects.create(
        name=name,
        token_hash=hash_token(raw_token),
        platform_label=platform_label,
        app_version=app_version,
    )
    return device, raw_token


def get_device_for_token(raw_token: str) -> Device | None:
    token_hash = hash_token(raw_token)
    try:
        return Device.objects.get(token_hash=token_hash, is_active=True, revoked_at__isnull=True)
    except Device.DoesNotExist:
        return None
