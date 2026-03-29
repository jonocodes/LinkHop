import json
import uuid
from functools import wraps

from django.core.exceptions import PermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from core.models import Device
from core.services.auth import create_pairing_pin, get_device_for_token, register_device_with_pairing_pin
from core.services.messages import (
    create_message,
    list_incoming_messages,
    mark_message_opened,
    mark_message_presented,
    mark_message_received,
)
from core.services.push import deactivate_push_subscription, get_public_push_config, upsert_push_subscription
from core.services.rate_limiter import (
    check_confirmation_rate_limit,
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


def json_message_response(message, status: int = 200) -> JsonResponse:
    return JsonResponse(serialize_message(message), status=status)


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
        return view_func(request, *args, **kwargs)

    return wrapped


@require_device_auth
def pairing_pin_create(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return HttpResponse(status=405)
    pairing_pin, raw_pin = create_pairing_pin(device=request.auth)
    return JsonResponse(
        {
            "pin": raw_pin,
            "expires_at": pairing_pin.expires_at.isoformat(),
        }
    )


def register_device_with_pin(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return HttpResponse(status=405)

    try:
        payload = parse_json_body(request)
    except DjangoValidationError as exc:
        return json_error("validation_error", "; ".join(exc.messages))

    raw_pin = str(payload.get("pin", "")).strip()
    device_name = str(payload.get("device_name", "")).strip()
    if not raw_pin or not device_name:
        return json_error("validation_error", "Both pin and device_name are required.")

    ip_address = get_client_ip(request)
    allowed, limit = check_registration_rate_limit(ip_address=ip_address)
    if not allowed:
        return json_error(
            "rate_limit_exceeded",
            f"Too many registration attempts. Maximum {limit} per hour.",
            status=429,
        )

    try:
        registration = register_device_with_pairing_pin(raw_pin=raw_pin, name=device_name)
    except IntegrityError:
        return json_error("device_name_conflict", "A device with that name already exists.")

    if registration is None:
        return json_error("invalid_pairing_pin", "Pairing PIN is invalid or expired.")

    device, raw_token = registration
    return JsonResponse(
        {
            "device": serialize_device(device),
            "token": raw_token,
        },
        status=201,
    )


@require_device_auth
def device_me(request: HttpRequest) -> JsonResponse:
    if request.method != "GET":
        return HttpResponse(status=405)
    return JsonResponse(serialize_device(request.auth))


@require_device_auth
def devices_list(request: HttpRequest) -> JsonResponse:
    if request.method != "GET":
        return HttpResponse(status=405)

    from core.selectors import is_device_online, list_active_devices

    devices = list_active_devices()
    return JsonResponse(
        [
            {
                **serialize_device(device),
                "is_online": is_device_online(device),
            }
            for device in devices
        ],
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
        user_agent=request.META.get("HTTP_USER_AGENT", ""),
    )
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
        )
    except Device.DoesNotExist:
        return json_error("recipient_not_found", "Recipient device was not found.")

    try:
        message = create_message(
            sender_device=request.auth,
            recipient_device=recipient,
            message_type=msg_type,
            body=body,
        )
    except DjangoValidationError as exc:
        return json_error("validation_error", "; ".join(exc.messages))

    return json_message_response(message, status=201)


@require_device_auth
def message_get(request: HttpRequest, message_id: str) -> JsonResponse:
    if request.method != "GET":
        return HttpResponse(status=405)
    try:
        from core.services.messages import _get_owned_message
        message = _get_owned_message(device=request.auth, message_id=message_id)
    except DjangoValidationError as exc:
        return json_error("not_found", "; ".join(exc.messages), status=404)
    except PermissionDenied as exc:
        return json_error("forbidden", str(exc), status=403)
    return json_message_response(message)


@require_device_auth
def messages_incoming(request: HttpRequest) -> JsonResponse:
    if request.method != "GET":
        return HttpResponse(status=405)
    return JsonResponse(
        [serialize_message(message) for message in list_incoming_messages(device=request.auth)],
        safe=False,
    )


@require_device_auth
def message_received(request: HttpRequest, message_id: str):
    if request.method != "POST":
        return HttpResponse(status=405)
    return _message_transition(request, message_id, mark_message_received)


@require_device_auth
def message_presented(request: HttpRequest, message_id: str):
    if request.method != "POST":
        return HttpResponse(status=405)
    return _message_transition(request, message_id, mark_message_presented)


@require_device_auth
def message_opened(request: HttpRequest, message_id: str):
    if request.method != "POST":
        return HttpResponse(status=405)
    return _message_transition(request, message_id, mark_message_opened)


def _message_transition(request: HttpRequest, message_id: str, handler):
    allowed, limit = check_confirmation_rate_limit(device_id=str(request.auth.id))
    if not allowed:
        return json_error(
            "rate_limit_exceeded",
            f"Too many confirmation attempts. Maximum {limit} per minute.",
            status=429,
        )

    try:
        message = handler(device=request.auth, message_id=message_id)
    except DjangoValidationError as exc:
        return json_error("validation_error", "; ".join(exc.messages))
    except PermissionDenied as exc:
        return json_error("forbidden", str(exc), status=403)

    return json_message_response(message)


def serialize_device(device: Device) -> dict:
    return {
        "id": str(device.id),
        "name": device.name,
        "is_active": device.is_active,
        "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None,
    }


def serialize_message(message) -> dict:
    return {
        "id": str(message.id),
        "sender_device_id": str(message.sender_device_id) if message.sender_device_id else None,
        "recipient_device_id": str(message.recipient_device_id),
        "type": message.type,
        "body": message.body,
        "status": message.status,
        "created_at": message.created_at.isoformat(),
        "expires_at": message.expires_at.isoformat(),
        "received_at": message.received_at.isoformat() if message.received_at else None,
        "presented_at": message.presented_at.isoformat() if message.presented_at else None,
        "opened_at": message.opened_at.isoformat() if message.opened_at else None,
    }
