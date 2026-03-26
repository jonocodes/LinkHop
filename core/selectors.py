from core.models import Device


def list_active_devices():
    return Device.objects.filter(is_active=True, revoked_at__isnull=True).order_by("name")


def is_device_online(device: Device) -> bool:
    from core.sse import active_stream_count
    return active_stream_count(str(device.id)) > 0
