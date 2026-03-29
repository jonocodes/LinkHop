from django.core.exceptions import PermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import HttpRequest
from django.utils import timezone
from ninja import NinjaAPI, Router

from core.api.auth import DeviceBearer
from core.api.schemas import (
    CreateMessageIn,
    DeviceListItemSchema,
    DeviceSchema,
    ErrorResponseSchema,
    MessageSchema,
    PairingPinOut,
    PushConfigSchema,
    PushSubscriptionDeleteIn,
    PushSubscriptionIn,
    RegisterDeviceOut,
    RegisterWithPinIn,
)
from core.models import Device
from core.selectors import is_device_online, list_active_devices
from core.services.auth import (
    create_pairing_pin,
    register_device_with_pairing_pin,
)
from core.services.messages import (
    create_message,
    list_incoming_messages,
    mark_message_opened,
    mark_message_presented,
    mark_message_received,
)
from core.services.push import (
    deactivate_push_subscription,
    get_public_push_config,
    upsert_push_subscription,
)
from core.services.rate_limiter import (
    check_confirmation_rate_limit,
    check_registration_rate_limit,
    check_sends_rate_limit,
    get_client_ip,
)

api = NinjaAPI(title="LinkHop API", urls_namespace="linkhop_api")
router = Router(tags=["devices"])
auth = DeviceBearer()


def _error(code: str, message: str):
    return 400, {"error": {"code": code, "message": message}}



@router.post("/pairings/pin", auth=auth, response=PairingPinOut)
def pairing_pin_create(request: HttpRequest):
    pairing_pin, raw_pin = create_pairing_pin(device=request.auth)
    return {
        "pin": raw_pin,
        "expires_at": pairing_pin.expires_at,
    }


@router.post(
    "/pairings/pin/register",
    response={201: RegisterDeviceOut, 400: ErrorResponseSchema, 429: ErrorResponseSchema},
)
def register_device_with_pin(request: HttpRequest, payload: RegisterWithPinIn):
    ip_address = get_client_ip(request)
    allowed, limit = check_registration_rate_limit(ip_address=ip_address)
    if not allowed:
        return 429, _error(
            "rate_limit_exceeded",
            f"Too many registration attempts. Maximum {limit} per hour.",
        )

    try:
        registration = register_device_with_pairing_pin(
            raw_pin=payload.pin,
            name=payload.device_name,
        )
    except IntegrityError:
        return _error("device_name_conflict", "A device with that name already exists.")

    if registration is None:
        return _error("invalid_pairing_pin", "Pairing PIN is invalid or expired.")

    device, raw_token = registration

    return 201, {
        "device": {
            "id": device.id,
            "name": device.name,
            "is_active": device.is_active,
            "last_seen_at": device.last_seen_at,
        },
        "token": raw_token,
    }


@router.get("/device/me", auth=auth, response=DeviceSchema)
def device_me(request: HttpRequest):
    device = request.auth
    return {
        "id": device.id,
        "name": device.name,
        "is_active": device.is_active,
        "last_seen_at": device.last_seen_at,
    }


@router.get("/devices", auth=auth, response=list[DeviceListItemSchema])
def devices_list(request: HttpRequest):
    del request
    devices = list_active_devices()
    return [
        {
            "id": device.id,
            "name": device.name,
            "is_active": device.is_active,
            "last_seen_at": device.last_seen_at,
            "is_online": is_device_online(device),
        }
        for device in devices
    ]


@router.get("/push/config", auth=auth, response=PushConfigSchema)
def push_config(request: HttpRequest):
    del request
    return get_public_push_config()


@router.post("/push/subscriptions", auth=auth, response={204: None, 400: ErrorResponseSchema})
def push_subscription_create(request: HttpRequest, payload: PushSubscriptionIn):
    if not payload.endpoint or not payload.keys.p256dh or not payload.keys.auth:
        return _error("validation_error", "Push subscription is incomplete.")

    upsert_push_subscription(
        device=request.auth,
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth_secret=payload.keys.auth,
        user_agent=request.META.get("HTTP_USER_AGENT", ""),
    )
    return 204, None


@router.delete("/push/subscriptions", auth=auth, response={204: None})
def push_subscription_delete(request: HttpRequest, payload: PushSubscriptionDeleteIn):
    deactivate_push_subscription(device=request.auth, endpoint=payload.endpoint)
    return 204, None


@router.post(
    "/messages",
    auth=auth,
    response={201: MessageSchema, 400: ErrorResponseSchema, 429: ErrorResponseSchema},
)
def messages_create(request: HttpRequest, payload: CreateMessageIn):
    allowed, limit = check_sends_rate_limit(device_id=str(request.auth.id))
    if not allowed:
        return 429, _error(
            "rate_limit_exceeded",
            f"Too many send attempts. Maximum {limit} per minute.",
        )

    try:
        recipient = Device.objects.get(
            id=payload.recipient_device_id,
            is_active=True,
            revoked_at__isnull=True,
        )
    except Device.DoesNotExist:
        return _error("recipient_not_found", "Recipient device was not found.")

    try:
        message = create_message(
            sender_device=request.auth,
            recipient_device=recipient,
            message_type=payload.type,
            body=payload.body,
        )
    except DjangoValidationError as exc:
        return _error("validation_error", "; ".join(exc.messages))

    return 201, _serialize_message(message)


@router.get("/messages/incoming", auth=auth, response=list[MessageSchema])
def messages_incoming(request: HttpRequest):
    return [_serialize_message(message) for message in list_incoming_messages(device=request.auth)]


@router.post(
    "/messages/{message_id}/received",
    auth=auth,
    response={200: MessageSchema, 400: ErrorResponseSchema, 403: ErrorResponseSchema, 429: ErrorResponseSchema},
)
def message_received(request: HttpRequest, message_id: str):
    allowed, limit = check_confirmation_rate_limit(device_id=str(request.auth.id))
    if not allowed:
        return 429, _error(
            "rate_limit_exceeded",
            f"Too many confirmation attempts. Maximum {limit} per minute.",
        )
    return _handle_transition(mark_message_received, request.auth, message_id)


@router.post(
    "/messages/{message_id}/presented",
    auth=auth,
    response={200: MessageSchema, 400: ErrorResponseSchema, 403: ErrorResponseSchema, 429: ErrorResponseSchema},
)
def message_presented(request: HttpRequest, message_id: str):
    allowed, limit = check_confirmation_rate_limit(device_id=str(request.auth.id))
    if not allowed:
        return 429, _error(
            "rate_limit_exceeded",
            f"Too many confirmation attempts. Maximum {limit} per minute.",
        )
    return _handle_transition(mark_message_presented, request.auth, message_id)


@router.post(
    "/messages/{message_id}/opened",
    auth=auth,
    response={200: MessageSchema, 400: ErrorResponseSchema, 403: ErrorResponseSchema, 429: ErrorResponseSchema},
)
def message_opened(request: HttpRequest, message_id: str):
    allowed, limit = check_confirmation_rate_limit(device_id=str(request.auth.id))
    if not allowed:
        return 429, _error(
            "rate_limit_exceeded",
            f"Too many confirmation attempts. Maximum {limit} per minute.",
        )
    return _handle_transition(mark_message_opened, request.auth, message_id)


def _handle_transition(handler, device, message_id: str):
    try:
        message = handler(device=device, message_id=message_id)
    except DjangoValidationError as exc:
        return _error("validation_error", "; ".join(exc.messages))
    except PermissionDenied as exc:
        return 403, {"error": {"code": "forbidden", "message": str(exc)}}
    return 200, _serialize_message(message)


def _serialize_message(message):
    return {
        "id": message.id,
        "sender_device_id": message.sender_device_id,
        "recipient_device_id": message.recipient_device_id,
        "type": message.type,
        "body": message.body,
        "status": message.status,
        "created_at": message.created_at,
        "expires_at": message.expires_at,
        "received_at": message.received_at,
        "presented_at": message.presented_at,
        "opened_at": message.opened_at,
    }


api.add_router("/api", router)
