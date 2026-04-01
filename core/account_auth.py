"""
Separate session-based auth for the account dashboard (/account/).

Completely independent of Django's request.user / admin auth.
Logging into /admin/ has no effect here, and vice versa.
"""
from functools import wraps

from django.contrib.auth import authenticate, get_user_model
from django.shortcuts import redirect

SESSION_KEY = "_linkhop_account_user_id"


def get_account_user(request):
    """Return the logged-in account user, or None."""
    user_id = request.session.get(SESSION_KEY)
    if user_id is None:
        return None
    User = get_user_model()
    try:
        return User.objects.get(pk=user_id, is_active=True)
    except User.DoesNotExist:
        request.session.pop(SESSION_KEY, None)
        return None


def account_session_login(request, user):
    request.session[SESSION_KEY] = user.pk


def account_session_logout(request):
    request.session.pop(SESSION_KEY, None)


def _redirect_to_login(request):
    from django.urls import reverse
    from urllib.parse import urlencode
    login_url = reverse("account_login")
    return redirect(f"{login_url}?{urlencode({'next': request.get_full_path()})}")


def account_login_required(view_func):
    """Redirect to account login if no account session is active."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = get_account_user(request)
        if user is None:
            return _redirect_to_login(request)
        request.account_user = user
        return view_func(request, *args, **kwargs)
    return wrapper


def account_and_device_required(view_func):
    """Require both account session and device cookie.

    Redirects to login if no session, or to activate-device if no device cookie.
    Sets request.account_user, request.device, and request.device_token.
    """
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = get_account_user(request)
        if user is None:
            return _redirect_to_login(request)
        request.account_user = user

        from core.device_auth import get_device_from_request
        device, raw_token = get_device_from_request(request)
        if device is None:
            from django.urls import reverse
            from urllib.parse import urlencode
            activate_url = reverse("account_activate_device")
            return redirect(f"{activate_url}?{urlencode({'next': request.get_full_path()})}")
        request.device = device
        request.device_token = raw_token
        return view_func(request, *args, **kwargs)
    return wrapper
