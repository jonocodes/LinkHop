from functools import wraps

from django.shortcuts import redirect

from core.services.auth import get_device_for_token

COOKIE_NAME = "linkhop_device"


def get_device_from_request(request):
    """Return (device, raw_token) from the device cookie, or (None, None)."""
    raw_token = request.COOKIES.get(COOKIE_NAME)
    if not raw_token:
        return None, None
    device = get_device_for_token(raw_token)
    return device, raw_token


def device_login_required(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        device, raw_token = get_device_from_request(request)
        if device is None:
            return redirect("connect")
        request.device = device
        request.device_token = raw_token
        return view_func(request, *args, **kwargs)
    return wrapper
