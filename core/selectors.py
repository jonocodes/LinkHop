from django.utils import timezone

from core.models import Device


def list_active_devices():
    return Device.objects.filter(is_active=True, revoked_at__isnull=True).order_by("name")


def is_device_online(device: Device) -> bool:
    if device.last_seen_at is None:
        return False
    return (timezone.now() - device.last_seen_at).total_seconds() < 60
