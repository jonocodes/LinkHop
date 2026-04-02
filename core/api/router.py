import json
import uuid
from functools import wraps

from django.utils import timezone
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from core.models import Device
from core.services.auth import get_device_for_token, provision_extension_device
from core.services.messages import relay_message
from core.services.push import (
    deactivate_push_subscription,
    get_public_push_config,
    relay_push_message,
    upsert_push_subscription,
)
from core.services.rate_limiter import (
    check_registration_rate_limit,
    check_sends_rate_limit,
    get_client_ip,
)


def parse_json_body(request: HttpRequest) -> dict:
    if not request.body:
        return {}

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise DjangoValidationError("Request body must be valid JSON.") from exc

    if not isinstance(payload, dict):
        raise DjangoValidationError("Request body must be a JSON object.")
    return payload


def json_error(code: str, message: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"error": {"code": code, "message": message}}, status=status)


def require_device_auth(view_func):
    @csrf_exempt
    @wraps(view_func)
    def wrapped(request: HttpRequest, *args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return HttpResponse(status=401)

        raw_token = auth_header.removeprefix("Bearer ").strip()
        device = get_device_for_token(raw_token)
        if device is None:
            return HttpResponse(status=401)

        device = Device.objects.filter(
            id=device.id,
            is_active=True,
            revoked_at__isnull=True,
        ).first()
        if device is None:
            return HttpResponse(status=401)

        request.auth = device
        request.device = device
        request.device_token = raw_token
        Device.objects.filter(id=device.id).update(last_seen_at=timezone.now())
        return view_func(request, *args, **kwargs)

    return wrapped


@csrf_exempt
def session_link(request: HttpRequest) -> JsonResponse:
    """Create or rotate an extension device for the currently logged-in web session."""
    if request.method != "POST":
        return HttpResponse(status=405)
    if not request.user.is_authenticated:
        return HttpResponse(status=401)
    device, raw_token = provision_extension_device(user=request.user)
    return JsonResponse({"device": serialize_device(device), "token": raw_token})


@require_device_auth
def device_me(request: HttpRequest) -> JsonResponse:
    if request.method != "GET":
        return HttpResponse(status=405)
    return JsonResponse(serialize_device(request.auth))


@require_device_auth
def devices_list(request: HttpRequest) -> JsonResponse:
    if request.method != "GET":
        return HttpResponse(status=405)

    from core.selectors import list_active_devices

    devices = list_active_devices(user=request.auth.owner)
    return JsonResponse(
        [serialize_device(device) for device in devices],
        safe=False,
    )


@require_device_auth
def push_config(request: HttpRequest) -> JsonResponse:
    if request.method != "GET":
        return HttpResponse(status=405)
    return JsonResponse(get_public_push_config())


@require_device_auth
def push_subscriptions(request: HttpRequest):
    if request.method not in {"POST", "DELETE"}:
        return HttpResponse(status=405)

    try:
        payload = parse_json_body(request)
    except DjangoValidationError as exc:
        return json_error("validation_error", "; ".join(exc.messages))

    endpoint = str(payload.get("endpoint", "")).strip()
    if request.method == "DELETE":
        deactivate_push_subscription(device=request.auth, endpoint=endpoint)
        return HttpResponse(status=204)

    keys = payload.get("keys", {}) if isinstance(payload.get("keys", {}), dict) else {}
    p256dh = str(keys.get("p256dh", "")).strip()
    auth_secret = str(keys.get("auth", "")).strip()

    if not endpoint or not p256dh or not auth_secret:
        return json_error("validation_error", "Push subscription is incomplete.")

    upsert_push_subscription(
        device=request.auth,
        endpoint=endpoint,
        p256dh=p256dh,
        auth_secret=auth_secret,
        client_type=str(payload.get("client_type", "")).strip(),
        user_agent=request.META.get("HTTP_USER_AGENT", ""),
    )

    # Update device type and browser/OS info from this request
    from core.ua import parse_ua
    client_type = str(payload.get("client_type", "")).strip()[:20]
    ua_string = request.META.get("HTTP_USER_AGENT", "")
    browser, os_str = parse_ua(ua_string)
    update_fields = []
    if client_type and client_type != "extension":
        request.auth.device_type = client_type
        update_fields.append("device_type")
    if browser and not request.auth.browser:
        request.auth.browser = browser
        update_fields.append("browser")
    if os_str and not request.auth.os:
        request.auth.os = os_str
        update_fields.append("os")
    if update_fields:
        request.auth.save(update_fields=update_fields + ["updated_at"])

    return HttpResponse(status=204)


@require_device_auth
def messages_create(request: HttpRequest):
    if request.method != "POST":
        return HttpResponse(status=405)

    try:
        payload = parse_json_body(request)
    except DjangoValidationError as exc:
        return json_error("validation_error", "; ".join(exc.messages))

    allowed, limit = check_sends_rate_limit(device_id=str(request.auth.id))
    if not allowed:
        return json_error(
            "rate_limit_exceeded",
            f"Too many send attempts. Maximum {limit} per minute.",
            status=429,
        )

    recipient_id = payload.get("recipient_device_id")
    msg_type = str(payload.get("type", ""))
    body = str(payload.get("body", ""))

    if msg_type not in {"url", "text"}:
        return json_error("validation_error", "Message type must be 'url' or 'text'.")

    try:
        recipient_uuid = uuid.UUID(str(recipient_id))
    except (ValueError, TypeError):
        return json_error("recipient_not_found", "Recipient device was not found.")

    try:
        recipient = Device.objects.get(
            id=recipient_uuid,
            is_active=True,
            revoked_at__isnull=True,
            owner=request.auth.owner,
        )
    except Device.DoesNotExist:
        return json_error("recipient_not_found", "Recipient device was not found.")

    try:
        result = relay_message(
            sender_device=request.auth,
            recipient_device=recipient,
            message_type=msg_type,
            body=body,
        )
    except DjangoValidationError as exc:
        return json_error("validation_error", "; ".join(exc.messages))

    return JsonResponse(result, status=201)


@require_device_auth
def push_test(request: HttpRequest) -> JsonResponse:
    """Send a test push notification to the requesting device."""
    if request.method != "POST":
        return HttpResponse(status=405)

    from core.models import PushSubscription

    subs = PushSubscription.objects.filter(device=request.auth, is_active=True)
    if not subs.exists():
        return json_error("no_subscription", "No active push subscription found for this device.")

    try:
        result = relay_push_message(
            device=request.auth,
            message_id=str(uuid.uuid4()),
            message_type="text",
            body="LinkHop push test \u2014 it works!",
            sender_name=request.auth.name,
            recipient_device_id=str(request.auth.id),
            created_at=timezone.now().isoformat(),
            is_test=True,
        )
    except Exception as exc:
        return json_error("push_failed", str(exc))

    return JsonResponse({"ok": True, "subscriptions": result["total"]})


def serialize_device(device: Device) -> dict:
    return {
        "id": str(device.id),
        "name": device.name,
        "is_active": device.is_active,
        "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None,
    }
