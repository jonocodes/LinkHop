import hashlib
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from core.models import Device, Message, PairingPin


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"



def _generate_pairing_pin() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


@transaction.atomic
def create_pairing_pin(*, device: Device | None = None) -> tuple[PairingPin, str]:
    if device is not None:
        PairingPin.objects.filter(
            created_by_device=device,
            used_at__isnull=True,
            is_active=True,
            expires_at__gt=timezone.now(),
        ).update(is_active=False, updated_at=timezone.now())

    for _ in range(20):
        raw_pin = _generate_pairing_pin()
        pin = PairingPin.objects.filter(code_hash=hash_token(raw_pin)).first()
        if pin is not None and pin.is_usable:
            continue

        pairing_pin = PairingPin.objects.create(
            code_hash=hash_token(raw_pin),
            created_by_device=device,
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

    device, raw_token = create_device_token(name=name)

    pin.used_at = timezone.now()
    pin.save(update_fields=["used_at", "updated_at"])
    return device, raw_token


def create_device_token(
    *,
    name: str,
) -> tuple[Device, str]:
    raw_token = generate_token("device")
    device = Device.objects.create(
        name=name,
        token_hash=hash_token(raw_token),
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
    Message.objects.filter(sender_device=device).delete()
    device.delete()
