from django.core.exceptions import ValidationError
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone

from core.device_auth import COOKIE_NAME, device_login_required, get_device_from_request
from core.models import Device, Message, MessageStatus, MessageType
from core.selectors import is_device_online, list_active_devices
from core.services.auth import get_device_for_token
from core.services.messages import create_message, mark_message_opened


def healthcheck(_request: HttpRequest) -> HttpResponse:
    return HttpResponse("ok", content_type="text/plain")


def _device_context(devices):
    return [
        {
            "id": str(d.id),
            "name": d.name,
            "is_online": is_device_online(d),
            "last_seen_at": d.last_seen_at,
        }
        for d in devices
    ]


def connect_view(request: HttpRequest) -> HttpResponse:
    # Already connected — go straight to inbox.
    device, _ = get_device_from_request(request)
    if device is not None:
        return redirect("inbox")

    if request.method == "GET":
        return render(request, "connect.html", {})

    raw_token = request.POST.get("token", "").strip()
    device = get_device_for_token(raw_token)
    if device is None:
        return render(request, "connect.html", {
            "error": "Token not recognised. Check the value and try again.",
        })

    response = redirect("inbox")
    response.set_cookie(
        COOKIE_NAME,
        raw_token,
        max_age=60 * 60 * 24 * 365,  # 1 year
        httponly=True,
        samesite="Lax",
    )
    return response


def disconnect_view(request: HttpRequest) -> HttpResponse:
    response = redirect("connect")
    response.delete_cookie(COOKIE_NAME)
    return response


@device_login_required
def send_view(request: HttpRequest) -> HttpResponse:
    from core.models import GlobalSettings
    gs = GlobalSettings.objects.filter(singleton_key="default").first()
    allow_self_send = gs.allow_self_send if gs is not None else False

    qs = list_active_devices()
    if not allow_self_send:
        qs = qs.exclude(id=request.device.id)
    devices = _device_context(qs)

    if request.method == "GET":
        return render(request, "send.html", {
            "devices": devices,
            "type": request.GET.get("type", "url"),
            "body": request.GET.get("body", ""),
            "device": request.device,
            "device_token": request.device_token,
        })

    msg_type = request.POST.get("type", "")
    body = request.POST.get("body", "")
    recipient_id = request.POST.get("recipient_device_id", "")

    errors = {}
    recipient = None

    if not recipient_id:
        errors["recipient"] = "Please select a recipient device."
    else:
        try:
            recipient = Device.objects.get(id=recipient_id, is_active=True, revoked_at__isnull=True)
        except (Device.DoesNotExist, ValueError):
            errors["recipient"] = "Selected device was not found."

    if msg_type not in (MessageType.URL, MessageType.TEXT):
        errors["type"] = "Invalid message type."

    if not errors:
        try:
            create_message(
                sender_device=request.device,
                recipient_device=recipient,
                message_type=msg_type,
                body=body,
            )
            return render(request, "send.html", {
                "devices": devices,
                "type": msg_type,
                "body": "",
                "success": True,
                "device": request.device,
                "device_token": request.device_token,
            })
        except ValidationError as exc:
            errors["body"] = "; ".join(exc.messages)

    return render(request, "send.html", {
        "devices": devices,
        "type": msg_type,
        "body": body,
        "selected_recipient": recipient_id,
        "errors": errors,
        "device": request.device,
        "device_token": request.device_token,
    })


@device_login_required
def inbox_view(request: HttpRequest) -> HttpResponse:
    messages = (
        Message.objects.filter(
            recipient_device=request.device,
            expires_at__gt=timezone.now(),
        )
        .exclude(status=MessageStatus.OPENED)
        .select_related("sender_device", "recipient_device")
        .order_by("created_at")
    )
    return render(request, "inbox.html", {
        "messages": messages,
        "device": request.device,
        "device_token": request.device_token,
    })


@device_login_required
def message_open_view(request: HttpRequest, message_id: str) -> HttpResponse:
    message = get_object_or_404(
        Message, id=message_id, type=MessageType.URL,
        recipient_device=request.device,
    )
    mark_message_opened(device=request.device, message_id=message.id)
    return redirect(message.body)


@device_login_required
def message_detail_view(request: HttpRequest, message_id: str) -> HttpResponse:
    message = get_object_or_404(
        Message, id=message_id, type=MessageType.TEXT,
        recipient_device=request.device,
    )
    mark_message_opened(device=request.device, message_id=message.id)
    return render(request, "message_detail.html", {
        "message": message,
        "device": request.device,
        "device_token": request.device_token,
    })
