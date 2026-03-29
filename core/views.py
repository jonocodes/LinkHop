from django.contrib import messages
from django.contrib import admin
from django.contrib.admin.helpers import AdminForm
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.http import JsonResponse
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.templatetags.static import static
from django.utils import timezone

from core.device_auth import COOKIE_NAME, device_login_required, get_device_from_request
from core.forms import GlobalSettingsForm
from core.models import Device, GlobalSettings, Message, MessageStatus, MessageType
from core.selectors import format_time_ago, is_device_online, list_active_devices
from core.services.auth import (
    create_pairing_pin,
    forget_device,
    register_device_with_pairing_pin,
)
from core.services.messages import create_message, mark_message_opened


def healthcheck(_request: HttpRequest) -> HttpResponse:
    return HttpResponse("ok", content_type="text/plain")


def home_view(request: HttpRequest) -> HttpResponse:
    device, _ = get_device_from_request(request)
    return render(request, "home.html", {
        "device": device,
        "github_url": "https://github.com/jonocodes/LinkHop",
    })


def manifest_view(request: HttpRequest) -> JsonResponse:
    del request
    manifest = {
        "name": "LinkHop",
        "short_name": "LinkHop",
        "description": "Send links and text between your devices",
        "start_url": "/inbox",
        "scope": "/",
        "display": "standalone",
        "background_color": "#f5f5f5",
        "theme_color": "#0066cc",
        "orientation": "portrait-primary",
        "icons": [
            {
                "src": static("linkhop/icons/icon-any.svg"),
                "sizes": "any",
                "type": "image/svg+xml",
                "purpose": "any",
            },
            {
                "src": static("linkhop/icons/icon-maskable.svg"),
                "sizes": "any",
                "type": "image/svg+xml",
                "purpose": "maskable",
            },
        ],
    }
    return JsonResponse(manifest)


def service_worker_view(request: HttpRequest) -> HttpResponse:
    shell_assets = [
        static("linkhop/pwa-register.js"),
        static("linkhop/icons/icon-any.svg"),
        static("linkhop/icons/icon-maskable.svg"),
        static("linkhop/notifications.js"),
        static("linkhop/push.js"),
        static("linkhop/sse-client.js"),
        "/manifest.json",
    ]
    static_prefix = settings.STATIC_URL if settings.STATIC_URL.startswith("/") else "/" + settings.STATIC_URL
    return render(request, "service-worker.js", {
        "cache_name": "linkhop-shell-v2",
        "shell_assets": shell_assets,
        "static_prefix": static_prefix,
        "icon_url": static("linkhop/icons/icon-any.svg"),
    }, content_type="application/javascript")


def admin_settings_view(request: HttpRequest) -> HttpResponse:
    settings_obj, _ = GlobalSettings.objects.get_or_create(singleton_key="default")

    if request.method == "POST":
        form = GlobalSettingsForm(request.POST, instance=settings_obj)
        if form.is_valid():
            form.save()
            messages.success(request, "Settings updated.")
            return redirect("admin_settings")
    else:
        form = GlobalSettingsForm(instance=settings_obj)

    context = {
        **admin.site.each_context(request),
        "title": "Settings",
        "form": form,
        "adminform": AdminForm(form, GlobalSettingsForm.FIELDSETS, {}),
        "opts": GlobalSettings._meta,
        "has_view_permission": True,
        "has_change_permission": True,
        "has_add_permission": False,
        "has_delete_permission": False,
        "settings_obj": settings_obj,
    }
    return render(request, "admin/settings_page.html", context)


def _device_context(devices):
    return [
        {
            "id": str(d.id),
            "name": d.name,
            "is_online": is_device_online(d),
            "last_seen_at": d.last_seen_at,
            "last_seen_ago": format_time_ago(d.last_seen_at),
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

    raw_pin = request.POST.get("pin", "").strip()
    device_name = request.POST.get("device_name", "").strip()
    if not raw_pin or not device_name:
        return render(request, "connect.html", {
            "pin_error": "Enter both the 6-digit PIN and a device name.",
            "pin": raw_pin,
            "device_name": device_name,
        })

    try:
        registration = register_device_with_pairing_pin(
            raw_pin=raw_pin,
            name=device_name,
        )
    except IntegrityError:
        return render(request, "connect.html", {
            "pin_error": "That device name is already in use.",
            "pin": raw_pin,
            "device_name": device_name,
        })

    if registration is None:
        return render(request, "connect.html", {
            "pin_error": "PIN not recognised or expired. Generate a new one and try again.",
            "pin": raw_pin,
            "device_name": device_name,
        })

    _device, raw_token = registration

    response = redirect("inbox")
    response.set_cookie(
        COOKIE_NAME,
        raw_token,
        max_age=60 * 60 * 24 * 365,
        httponly=True,
        samesite="Lax",
    )
    return response


@device_login_required
def pair_view(request: HttpRequest) -> HttpResponse:
    pin = None
    expires_at = None

    if request.method == "POST":
        pairing_pin, raw_pin = create_pairing_pin(device=request.device)
        pin = raw_pin
        expires_at = pairing_pin.expires_at

    return render(request, "pair.html", {
        "device": request.device,
        "pin": pin,
        "expires_at": expires_at,
    })


def disconnect_view(request: HttpRequest) -> HttpResponse:
    device, _raw_token = get_device_from_request(request)
    if device is not None:
        forget_device(device=device)

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
            "type": request.GET.get("type", "text"),
            "body": request.GET.get("body", ""),
            "selected_recipient": devices[0]["id"] if len(devices) == 1 else "",
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
