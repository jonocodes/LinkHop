import hashlib
import secrets

from django.contrib.auth import authenticate as django_authenticate
from django.db import transaction

from core.models import Device, DeviceType


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def register_device_for_user(
    *,
    user,
    device_name: str,
) -> tuple[Device, str]:
    """Create a new device for an already-authenticated user.

    Returns (device, raw_token).
    """
    return create_device_token(name=device_name, owner=user)


def authenticate_and_register_device(
    *,
    username: str,
    password: str,
    device_name: str,
) -> tuple[Device, str] | None:
    """Authenticate with username + password, create a new device for that user.

    Returns (device, raw_token) on success, None if credentials are invalid.
    """
    user = django_authenticate(username=username, password=password)
    if user is None or not user.is_active:
        return None
    return create_device_token(name=device_name, owner=user)


def create_device_token(
    *,
    name: str,
    owner=None,
) -> tuple[Device, str]:
    raw_token = generate_token("device")
    device = Device.objects.create(
        name=name,
        token_hash=hash_token(raw_token),
        owner=owner,
    )
    return device, raw_token


_SYSTEM_DEVICE_NAME = "Admin"
_SYSTEM_TOKEN_HASH = "system:admin"  # not a valid hash_token output — auth will never match it


def get_system_device() -> Device:
    """Return the virtual admin/system device, creating it on first call."""
    device, _ = Device.objects.get_or_create(
        name=_SYSTEM_DEVICE_NAME,
        defaults={"token_hash": _SYSTEM_TOKEN_HASH},
    )
    return device


@transaction.atomic
def provision_extension_device(*, user) -> tuple[Device, str]:
    """Get or create the extension device for a user, rotating its token."""
    raw_token = generate_token("device")
    device = Device.objects.filter(
        owner=user,
        device_type=DeviceType.EXTENSION,
        is_active=True,
        revoked_at__isnull=True,
    ).first()
    if device is not None:
        device.token_hash = hash_token(raw_token)
        device.save(update_fields=["token_hash", "updated_at"])
    else:
        device = Device.objects.create(
            name="Browser Extension",
            token_hash=hash_token(raw_token),
            owner=user,
            device_type=DeviceType.EXTENSION,
        )
    return device, raw_token


def get_device_for_token(raw_token: str) -> Device | None:
    token_hash = hash_token(raw_token)
    try:
        return Device.objects.get(token_hash=token_hash, is_active=True, revoked_at__isnull=True)
    except Device.DoesNotExist:
        return None


@transaction.atomic
def forget_device(*, device: Device) -> None:
    device.delete()
