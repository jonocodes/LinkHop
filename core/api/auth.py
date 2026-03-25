from ninja.security import HttpBearer

from core.services.auth import get_device_for_token


class DeviceBearer(HttpBearer):
    def authenticate(self, request, token):
        device = get_device_for_token(token)
        if device is None:
            return None
        request.device = device
        return device
