import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from core.models import Device, EnrollmentToken, PairingPin


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


def _generate_pairing_pin() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


@transaction.atomic
def create_pairing_pin(*, device: Device) -> tuple[PairingPin, str]:
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


def consume_pairing_pin(raw_pin: str) -> PairingPin | None:
    pin_hash = hash_token(raw_pin)
    try:
        pin = PairingPin.objects.select_related("created_by_device").get(code_hash=pin_hash)
    except PairingPin.DoesNotExist:
        return None

    if not pin.is_usable:
        return None

    pin.used_at = timezone.now()
    pin.save(update_fields=["used_at", "updated_at"])
    return pin


@transaction.atomic
def register_device_with_pairing_pin(
    *,
    raw_pin: str,
    name: str,
    platform_label: str = "",
    app_version: str = "",
) -> tuple[Device, str] | None:
    pin_hash = hash_token(raw_pin)
    try:
        pin = PairingPin.objects.select_for_update().get(code_hash=pin_hash)
    except PairingPin.DoesNotExist:
        return None

    if not pin.is_usable:
        return None

    try:
        device, raw_token = create_device_token(
            name=name,
            platform_label=platform_label,
            app_version=app_version,
        )
    except IntegrityError:
        raise

    pin.used_at = timezone.now()
    pin.save(update_fields=["used_at", "updated_at"])
    return device, raw_token


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
