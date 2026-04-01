import hashlib
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from core.models import Device, DeviceType, PairingPin


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"



def _generate_pairing_pin() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


@transaction.atomic
def create_pairing_pin(*, device: Device | None = None, owner=None) -> tuple[PairingPin, str]:
    resolved_owner = owner or (device.owner if device is not None else None)

    if device is not None:
        PairingPin.objects.filter(
            created_by_device=device,
            used_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).delete()
    elif resolved_owner is not None:
        PairingPin.objects.filter(
            owner=resolved_owner,
            created_by_device__isnull=True,
            used_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).delete()

    for _ in range(20):
        raw_pin = _generate_pairing_pin()
        pin = PairingPin.objects.filter(code_hash=hash_token(raw_pin)).first()
        if pin is not None and pin.is_usable:
            continue

        pairing_pin = PairingPin.objects.create(
            code_hash=hash_token(raw_pin),
            created_by_device=device,
            owner=resolved_owner,
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        return pairing_pin, raw_pin

    raise RuntimeError("Unable to allocate a unique pairing PIN.")




@transaction.atomic
def register_device_with_pairing_pin(
    *,
    raw_pin: str,
    name: str,
) -> tuple[Device, str] | None:
    pin_hash = hash_token(raw_pin)
    try:
        pin = PairingPin.objects.select_for_update().get(code_hash=pin_hash)
    except PairingPin.DoesNotExist:
        return None

    if not pin.is_usable:
        return None

    device, raw_token = create_device_token(name=name, owner=pin.owner)

    pin.used_at = timezone.now()
    pin.save(update_fields=["used_at", "updated_at"])
    return device, raw_token


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
