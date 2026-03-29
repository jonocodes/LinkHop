import json

from django.contrib import messages
from django.contrib import admin
from django.contrib.admin.helpers import AdminForm
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.http import JsonResponse
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.templatetags.static import static
from django.utils.http import urlencode, url_has_allowed_host_and_scheme
from django.utils import timezone

from core.device_auth import COOKIE_NAME, device_login_required, get_device_from_request
from core.forms import GlobalSettingsForm
from core.models import Device, GlobalSettings, Message, MessageStatus, MessageType
from core.selectors import device_presence_status, format_time_ago, is_device_online, list_active_devices
from core.services.auth import (
    _SYSTEM_DEVICE_NAME,
    create_pairing_pin,
    forget_device,
    get_system_device,
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


def admin_bookmarklet_view(request: HttpRequest) -> HttpResponse:
    hop_url = request.build_absolute_uri("/hop")
    bookmarklet_js = (
        "javascript:(function(){"
        f"var u={json.dumps(hop_url)};"
        "var q='?type=url&body='+encodeURIComponent(window.location.href);"
        "var target=u+q;"
        "var popup=window.open(target,'linkhop','popup,width=540,height=720,resizable=yes,scrollbars=yes');"
        "if(!popup){window.location.href=target;}"
        "})();"
    )

    context = {
        **admin.site.each_context(request),
        "title": "Bookmarklet",
        "bookmarklet_js": bookmarklet_js,
        "hop_url": hop_url,
    }
    return render(request, "admin/bookmarklet_page.html", context)


def admin_add_device_view(request: HttpRequest) -> HttpResponse:
    from core.models import PairingPin

    SESSION_KEY = "admin_pending_pin"

    if request.method == "POST":
        action = request.POST.get("action", "create")

        if action == "cancel":
            pending = request.session.pop(SESSION_KEY, None)
            if pending:
                PairingPin.objects.filter(id=pending["id"], used_at__isnull=True).delete()
            return redirect("admin_connected_devices")

        # action == "create"
        pairing_pin, raw_pin = create_pairing_pin()
        request.session[SESSION_KEY] = {
            "id": str(pairing_pin.id),
            "raw_pin": raw_pin,
            "expires_at_iso": pairing_pin.expires_at.isoformat(),
        }
        return redirect("admin_add_device")

    # GET — restore active PIN from session if still usable
    pin = None
    expires_at_iso = ""
    pending = request.session.get(SESSION_KEY)
    if pending:
        try:
            pp = PairingPin.objects.get(id=pending["id"])
            if pp.is_usable:
                pin = pending["raw_pin"]
                expires_at_iso = pending["expires_at_iso"]
            else:
                del request.session[SESSION_KEY]
        except PairingPin.DoesNotExist:
            del request.session[SESSION_KEY]

    connect_url = request.build_absolute_uri(reverse("connect"))
    context = {
        **admin.site.each_context(request),
        "title": "Add device",
        "pin": pin,
        "expires_at_iso": expires_at_iso,
        "connect_base_url": connect_url,
    }
    return render(request, "admin/add_device_page.html", context)


def admin_send_test_message_view(request: HttpRequest, device_id: str) -> HttpResponse:
    if request.method != "POST":
        return redirect("admin_connected_devices")
    try:
        recipient = Device.objects.get(id=device_id)
    except Device.DoesNotExist:
        messages.error(request, "Device not found.")
        return redirect("admin_connected_devices")

    try:
        create_message(
            sender_device=get_system_device(),
            recipient_device=recipient,
            message_type=MessageType.TEXT,
            body="test message",
        )
        messages.success(request, f"Test message sent to {recipient.name}.")
    except Exception as exc:
        messages.error(request, f"Failed to send to {recipient.name}: {exc}")
    return redirect("admin_connected_devices")


def admin_connected_devices_view(request: HttpRequest) -> HttpResponse:
    all_devices = Device.objects.exclude(name=_SYSTEM_DEVICE_NAME).order_by("name")
    status_order = {"online": 0, "recent": 1, "offline": 2}
    device_list = []
    for d in all_devices:
        status = device_presence_status(d)
        device_list.append({
            "id": str(d.id),
            "name": d.name,
            "presence": status,
            "is_active": d.is_active,
            "revoked_at": d.revoked_at,
            "last_seen_at": d.last_seen_at,
            "last_seen_ago": format_time_ago(d.last_seen_at),
            "created_at": d.created_at,
        })
    device_list.sort(key=lambda d: (status_order[d["presence"]], d["last_seen_at"] is None, -(d["last_seen_at"].timestamp() if d["last_seen_at"] else 0)))

    context = {
        **admin.site.each_context(request),
        "title": "Connected devices",
        "devices": device_list,
    }
    return render(request, "admin/connected_devices_page.html", context)


def _device_context(devices):
    status_order = {"online": 0, "recent": 1, "offline": 2}
    items = [
        {
            "id": str(d.id),
            "name": d.name,
            "presence": device_presence_status(d),
            "last_seen_at": d.last_seen_at,
            "last_seen_ago": format_time_ago(d.last_seen_at),
        }
        for d in devices
    ]
    items.sort(key=lambda d: status_order[d["presence"]])
    return items


def _validated_next_url(request: HttpRequest, candidate: str) -> str:
    candidate = (candidate or "").strip()
    if candidate and url_has_allowed_host_and_scheme(
        url=candidate,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return candidate
    return ""


def connect_view(request: HttpRequest) -> HttpResponse:
    # Already connected — go straight to inbox.
    device, _ = get_device_from_request(request)
    if device is not None:
        return redirect("inbox")

    if request.method == "GET":
        return render(request, "connect.html", {
            "pin": request.GET.get("pin", "").strip(),
            "redirect_to": _validated_next_url(request, request.GET.get("next", "")),
        })

    raw_pin = request.POST.get("pin", "").strip()
    device_name = request.POST.get("device_name", "").strip()
    redirect_to = _validated_next_url(request, request.POST.get("next", ""))
    if not raw_pin or not device_name:
        return render(request, "connect.html", {
            "pin_error": "Enter both the 6-digit PIN and a device name.",
            "pin": raw_pin,
            "device_name": device_name,
            "redirect_to": redirect_to,
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
            "redirect_to": redirect_to,
        })

    if registration is None:
        return render(request, "connect.html", {
            "pin_error": "PIN not recognised or expired. Generate a new one and try again.",
            "pin": raw_pin,
            "device_name": device_name,
            "redirect_to": redirect_to,
        })

    _device, raw_token = registration

    response = redirect(redirect_to or "inbox")
    response.set_cookie(
        COOKIE_NAME,
        raw_token,
        max_age=60 * 60 * 24 * 365,
        httponly=True,
        samesite="Lax",
    )
    return response


def hop_view(request: HttpRequest) -> HttpResponse:
    device, _raw_token = get_device_from_request(request)
    if device is None:
        connect_url = "/connect?" + urlencode({"next": request.get_full_path()})
        return redirect(connect_url)

    from core.models import GlobalSettings
    gs = GlobalSettings.objects.filter(singleton_key="default").first()
    allow_self_send = gs.allow_self_send if gs is not None else False

    qs = list_active_devices()
    if not allow_self_send:
        qs = qs.exclude(id=device.id)
    devices = _device_context(qs)

    if request.method == "POST":
        recipient_id = request.POST.get("recipient_device_id", "")
        msg_type = request.POST.get("type", "")
        body = request.POST.get("body", "")
        error = None
        try:
            recipient = Device.objects.get(id=recipient_id, is_active=True, revoked_at__isnull=True)
            create_message(
                sender_device=device,
                recipient_device=recipient,
                message_type=msg_type,
                body=body,
            )
        except (Device.DoesNotExist, ValueError):
            error = "Device not found."
        except ValidationError as exc:
            error = "; ".join(exc.messages)
        return render(request, "hop.html", {
            "sent": error is None,
            "error": error,
            "device": device,
        })

    return render(request, "hop.html", {
        "devices": devices,
        "msg_type": request.GET.get("type", "url"),
        "body": request.GET.get("body", ""),
        "device": device,
    })


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
        "expires_at_iso": expires_at.isoformat() if expires_at else "",
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
