from ninja.security import HttpBearer

from core.models import Device
from core.services.auth import get_device_for_token


class DeviceBearer(HttpBearer):
    def authenticate(self, request, token):
        device = get_device_for_token(token)
        if device is None:
            return None

        device = Device.objects.filter(
            id=device.id,
            is_active=True,
            revoked_at__isnull=True,
        ).first()

        if device is None:
            return None

        request.device = device
        return device
