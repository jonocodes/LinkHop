import datetime
import json
import os

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

from core.account_auth import account_and_device_required, account_login_required, account_session_login, account_session_logout, get_account_user
from core.account_site import account_site
from core.device_auth import COOKIE_NAME, get_device_from_request
from core.forms import GlobalSettingsForm
from core.models import Device, GlobalSettings, MessageType
from core.selectors import device_presence_status, format_time_ago, list_active_devices
from core.services.auth import (
    _SYSTEM_DEVICE_NAME,
    authenticate_and_register_device,
    forget_device,
    get_system_device,
    register_device_for_user,
)
from core.services.messages import relay_message


def healthcheck(_request: HttpRequest) -> HttpResponse:
    return HttpResponse("ok", content_type="text/plain")


def home_view(request: HttpRequest) -> HttpResponse:
    device, _ = get_device_from_request(request)
    account_user = get_account_user(request)
    return render(request, "home.html", {
        "device": device,
        "account_user": account_user,
        "github_url": "https://github.com/jonocodes/LinkHop",
    })


def manifest_view(request: HttpRequest) -> JsonResponse:
    del request
    manifest = {
        "name": "LinkHop",
        "short_name": "LinkHop",
        "description": "Send links and text between your devices",
        "start_url": "/account/inbox/",
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
        "share_target": {
            "action": "/share",
            "method": "GET",
            "params": {
                "title": "title",
                "text": "text",
                "url": "url",
            },
        },
    }
    return JsonResponse(manifest)


def share_target_view(request: HttpRequest) -> HttpResponse:
    """Handle Web Share Target API requests from Android."""
    title = request.GET.get("title", "")
    text = request.GET.get("text", "")
    url = request.GET.get("url", "")

    shared_content = url or text or title
    if text and url and text != url:
        shared_content = f"{text}\n{url}"
    elif title and (text or url):
        shared_content = f"{title}\n{text or url}"

    msg_type = "url" if url else "text"

    device, _ = get_device_from_request(request)
    if device is None:
        request.session["pending_share"] = shared_content
        request.session["pending_share_type"] = msg_type
        user = get_account_user(request)
        if user is not None:
            return redirect("account_activate_device")
        return redirect("account_login")

    return redirect(f"/account/send/?{urlencode({'body': shared_content, 'type': msg_type})}")


def service_worker_view(request: HttpRequest) -> HttpResponse:
    shell_assets = [
        static("linkhop/pwa-register.js"),
        static("linkhop/icons/icon-any.svg"),
        static("linkhop/icons/icon-maskable.svg"),
        static("linkhop/push.js"),
        "/manifest.json",
    ]
    static_prefix = settings.STATIC_URL if settings.STATIC_URL.startswith("/") else "/" + settings.STATIC_URL
    return render(request, "service-worker.js", {
        "cache_name": "linkhop-shell-v3",
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


def admin_send_test_message_view(request: HttpRequest, device_id: str) -> HttpResponse:
    if request.method != "POST":
        return redirect("admin_connected_devices")

    sender_device, _ = get_device_from_request(request)
    if sender_device is None:
        sender_device = get_system_device()

    try:
        recipient = Device.objects.get(id=device_id)
    except Device.DoesNotExist:
        messages.error(request, "Device not found.")
        return redirect("admin_connected_devices")

    try:
        relay_message(
            sender_device=sender_device,
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
    status_order = {"recent": 0, "offline": 1}
    device_list = []
    for d in all_devices:
        status = device_presence_status(d)
        last_active = d.last_active_at
        device_list.append({
            "id": str(d.id),
            "name": d.name,
            "presence": status,
            "is_active": d.is_active,
            "revoked_at": d.revoked_at,
            "last_seen_at": d.last_seen_at,
            "last_seen_ago": format_time_ago(d.last_seen_at),
            "last_active_at": last_active,
            "last_active_ago": format_time_ago(last_active),
            "device_type": d.device_type,
            "browser": d.browser,
            "os": d.os,
            "created_at": d.created_at,
        })
    device_list.sort(key=lambda d: (status_order.get(d["presence"], 2), d["last_active_at"] is None, -(d["last_active_at"].timestamp() if d["last_active_at"] else 0)))

    context = {
        **admin.site.each_context(request),
        "title": "Connected devices",
        "devices": device_list,
    }
    return render(request, "admin/connected_devices_page.html", context)


def _device_context(devices):
    status_order = {"recent": 0, "offline": 1}
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
    items.sort(key=lambda d: status_order.get(d["presence"], 2))
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
    """Legacy /connect — redirect to account activate-device or login."""
    device, _ = get_device_from_request(request)
    if device is not None:
        return redirect("account_inbox")

    user = get_account_user(request)
    if user is not None:
        next_url = request.GET.get("next", "")
        qs = urlencode({"next": next_url}) if next_url else ""
        return redirect(f"{reverse('account_activate_device')}{'?' + qs if qs else ''}")

    # Not logged in — go to account login, preserving next
    next_url = request.GET.get("next", "")
    qs = urlencode({"next": next_url}) if next_url else ""
    return redirect(f"{reverse('account_login')}{'?' + qs if qs else ''}")


def hop_view(request: HttpRequest) -> HttpResponse:
    device, _raw_token = get_device_from_request(request)
    if device is None:
        # Check account session — if logged in but no device, go to activate
        user = get_account_user(request)
        if user is not None:
            return redirect(f"{reverse('account_activate_device')}?{urlencode({'next': request.get_full_path()})}")
        return redirect(f"{reverse('account_login')}?{urlencode({'next': request.get_full_path()})}")

    from core.models import GlobalSettings
    gs = GlobalSettings.objects.filter(singleton_key="default").first()
    allow_self_send = gs.allow_self_send if gs is not None else False

    qs = list_active_devices(user=device.owner)
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
            relay_message(
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


def disconnect_view(request: HttpRequest) -> HttpResponse:
    device, _raw_token = get_device_from_request(request)
    if device is not None:
        forget_device(device=device)

    response = redirect("account_connected_devices")
    response.delete_cookie(COOKIE_NAME)
    return response


@account_and_device_required
def account_send_view(request: HttpRequest) -> HttpResponse:
    from core.models import GlobalSettings
    gs = GlobalSettings.objects.filter(singleton_key="default").first()
    allow_self_send = gs.allow_self_send if gs is not None else False

    qs = list_active_devices(user=request.device.owner)
    if not allow_self_send:
        qs = qs.exclude(id=request.device.id)
    devices = _device_context(qs)

    base_ctx = {
        **account_site.each_context(request),
        "title": "Send",
        "device": request.device,
        "device_token": request.device_token,
    }

    if request.method == "GET":
        return render(request, "account/send_page.html", {
            **base_ctx,
            "devices": devices,
            "type": request.GET.get("type", "text"),
            "body": request.GET.get("body", ""),
            "selected_recipient": devices[0]["id"] if len(devices) == 1 else "",
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
            relay_message(
                sender_device=request.device,
                recipient_device=recipient,
                message_type=msg_type,
                body=body,
            )
            return render(request, "account/send_page.html", {
                **base_ctx,
                "devices": devices,
                "type": msg_type,
                "body": "",
                "success": True,
                "sent_body": body,
                "sent_recipient_id": str(recipient.id),
                "sent_recipient_name": recipient.name,
            })
        except ValidationError as exc:
            errors["body"] = "; ".join(exc.messages)

    return render(request, "account/send_page.html", {
        **base_ctx,
        "devices": devices,
        "type": msg_type,
        "body": body,
        "selected_recipient": recipient_id,
        "errors": errors,
    })


@account_and_device_required
def account_inbox_view(request: HttpRequest) -> HttpResponse:
    """Client-side inbox — messages are stored in IndexedDB via the service worker."""
    return render(request, "account/inbox_page.html", {
        **account_site.each_context(request),
        "title": "Inbox",
        "device": request.device,
        "device_token": request.device_token,
    })


@account_and_device_required
def account_debug_view(request: HttpRequest) -> HttpResponse:
    from core.models import PushSubscription
    from core.services.push import get_public_push_config

    subs = PushSubscription.objects.filter(device=request.device).order_by("-updated_at")

    # Uptime via /proc/self/stat (start time in clock ticks since boot)
    uptime_str = "unavailable"
    try:
        with open("/proc/uptime") as f:
            boot_seconds = float(f.read().split()[0])
        proc_start_ticks = int(open("/proc/self/stat").read().split()[21])
        clock_ticks = os.sysconf("SC_CLK_TCK")
        proc_uptime_seconds = boot_seconds - (proc_start_ticks / clock_ticks)
        uptime = datetime.timedelta(seconds=int(proc_uptime_seconds))
        hours, remainder = divmod(int(uptime.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        uptime_str = f"{hours}h {minutes}m {seconds}s"
    except Exception:
        pass

    device_count = Device.objects.filter(is_active=True).exclude(name=_SYSTEM_DEVICE_NAME).count()

    return render(request, "account/debug_page.html", {
        **account_site.each_context(request),
        "title": "Debug",
        "device": request.device,
        "device_token": request.device_token,
        "push_config": get_public_push_config(),
        "subscriptions": subs,
        "uptime": uptime_str,
        "device_count": device_count,
    })


# ---------------------------------------------------------------------------
# Account dashboard views  (/account/...)
# ---------------------------------------------------------------------------

def account_login_view(request: HttpRequest) -> HttpResponse:
    if get_account_user(request) is not None:
        # Already logged in — if device cookie present go to inbox, else devices page
        device, _ = get_device_from_request(request)
        if device is not None:
            return redirect("account_inbox")
        return redirect("account_connected_devices")

    error = None
    if request.method == "POST":
        from django.contrib.auth import authenticate as django_authenticate
        username = request.POST.get("username", "").strip()
        password = request.POST.get("password", "")
        user = django_authenticate(request, username=username, password=password)
        if user is not None and user.is_active:
            account_session_login(request, user)
            next_url = _validated_next_url(request, request.POST.get("next", ""))
            if not next_url:
                # If browser already has a device cookie, go straight to inbox
                device, _ = get_device_from_request(request)
                next_url = reverse("account_inbox") if device else reverse("account_connected_devices")
            return redirect(next_url)
        error = "Invalid username or password."

    return render(request, "account/login.html", {
        "error": error,
        "next": request.GET.get("next", ""),
    })


def account_logout_view(request: HttpRequest) -> HttpResponse:
    account_session_logout(request)
    return redirect("account_login")


@account_login_required
def account_activate_device_view(request: HttpRequest) -> HttpResponse:
    """Register the current browser as a device for the logged-in account."""
    # Already has a device cookie — tell the user instead of showing the form.
    device, _ = get_device_from_request(request)
    if device is not None:
        messages.info(request, f'This device is already registered as "{device.name}".')
        return redirect("account_connected_devices")

    redirect_to = _validated_next_url(request, request.GET.get("next", "") if request.method == "GET" else request.POST.get("next", ""))

    if request.method == "GET":
        return render(request, "account/activate_device_page.html", {
            **account_site.each_context(request),
            "title": "Activate this browser",
            "redirect_to": redirect_to,
        })

    device_name = request.POST.get("device_name", "").strip()
    if not device_name:
        return render(request, "account/activate_device_page.html", {
            **account_site.each_context(request),
            "title": "Activate this browser",
            "error": "Device name is required.",
            "redirect_to": redirect_to,
        })

    try:
        _device, raw_token = register_device_for_user(
            user=request.account_user,
            device_name=device_name,
        )
    except IntegrityError:
        return render(request, "account/activate_device_page.html", {
            **account_site.each_context(request),
            "title": "Activate this browser",
            "error": "That device name is already in use for this account.",
            "device_name": device_name,
            "redirect_to": redirect_to,
        })

    # Check for pending share in session
    pending_share = request.session.get("pending_share")
    if pending_share:
        pending_type = request.session.pop("pending_share_type", "text")
        del request.session["pending_share"]
        request.session.modified = True
        response = redirect(f"/account/send/?{urlencode({'body': pending_share, 'type': pending_type})}")
    else:
        response = redirect(redirect_to or "account_inbox")

    response.set_cookie(
        COOKIE_NAME,
        raw_token,
        max_age=60 * 60 * 24 * 365,
        httponly=True,
        samesite="Lax",
    )
    return response


@account_login_required
def account_connected_devices_view(request: HttpRequest) -> HttpResponse:
    all_devices = Device.objects.filter(
        owner=request.account_user,
    ).exclude(name=_SYSTEM_DEVICE_NAME).order_by("name")

    status_order = {"recent": 0, "offline": 1}
    device_list = []
    for d in all_devices:
        status = device_presence_status(d)
        last_active = d.last_active_at
        device_list.append({
            "id": str(d.id),
            "name": d.name,
            "presence": status,
            "is_active": d.is_active,
            "revoked_at": d.revoked_at,
            "last_seen_at": d.last_seen_at,
            "last_seen_ago": format_time_ago(d.last_seen_at),
            "last_active_at": last_active,
            "last_active_ago": format_time_ago(last_active),
            "device_type": d.device_type,
            "browser": d.browser,
            "os": d.os,
            "created_at": d.created_at,
        })
    device_list.sort(key=lambda d: (
        status_order.get(d["presence"], 2),
        d["last_active_at"] is None,
        -(d["last_active_at"].timestamp() if d["last_active_at"] else 0),
    ))

    context = {
        **account_site.each_context(request),
        "title": "Connected devices",
        "devices": device_list,
    }
    return render(request, "account/connected_devices_page.html", context)


@account_login_required
def account_send_test_message_view(request: HttpRequest, device_id: str) -> HttpResponse:
    if request.method != "POST":
        return redirect("account_connected_devices")

    sender_device, _ = get_device_from_request(request)
    if sender_device is None:
        messages.info(request, "Register this device first to send test messages.")
        return redirect("account_activate_device")

    try:
        recipient = Device.objects.get(id=device_id, owner=request.account_user)
    except Device.DoesNotExist:
        messages.error(request, "Device not found.")
        return redirect("account_connected_devices")

    try:
        relay_message(
            sender_device=sender_device,
            recipient_device=recipient,
            message_type=MessageType.TEXT,
            body="test message",
        )
        messages.success(request, f"Test message sent to {recipient.name}.")
    except Exception as exc:
        messages.error(request, f"Failed to send to {recipient.name}: {exc}")
    return redirect("account_connected_devices")


@account_login_required
def account_rename_device_view(request: HttpRequest, device_id: str) -> HttpResponse:
    if request.method != "POST":
        return redirect("account_connected_devices")
    try:
        device = Device.objects.get(id=device_id, owner=request.account_user)
    except Device.DoesNotExist:
        messages.error(request, "Device not found.")
        return redirect("account_connected_devices")

    new_name = request.POST.get("name", "").strip()
    if not new_name:
        messages.error(request, "Name cannot be empty.")
        return redirect("account_connected_devices")
    if len(new_name) > 100:
        messages.error(request, "Name is too long.")
        return redirect("account_connected_devices")

    device.name = new_name
    device.save(update_fields=["name", "updated_at"])
    messages.success(request, f"Device renamed to \"{new_name}\".")
    return redirect("account_connected_devices")


@account_login_required
def account_remove_device_view(request: HttpRequest, device_id: str) -> HttpResponse:
    if request.method != "POST":
        return redirect("account_connected_devices")
    try:
        device = Device.objects.get(id=device_id, owner=request.account_user)
    except Device.DoesNotExist:
        messages.error(request, "Device not found.")
        return redirect("account_connected_devices")

    forget_device(device=device)
    messages.success(request, "Device removed.")
    return redirect("account_connected_devices")


@account_login_required
def account_bookmarklet_view(request: HttpRequest) -> HttpResponse:
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
        **account_site.each_context(request),
        "title": "Bookmarklet",
        "bookmarklet_js": bookmarklet_js,
        "hop_url": hop_url,
    }
    return render(request, "account/bookmarklet_page.html", context)


@account_login_required
def account_change_password_view(request: HttpRequest) -> HttpResponse:
    error = None
    success = False

    if request.method == "POST":
        from django.contrib.auth import authenticate as django_authenticate
        current = request.POST.get("current_password", "")
        new = request.POST.get("new_password", "")
        confirm = request.POST.get("confirm_password", "")

        user = request.account_user
        if not user.check_password(current):
            error = "Current password is incorrect."
        elif not new:
            error = "New password cannot be empty."
        elif new != confirm:
            error = "New passwords do not match."
        else:
            user.set_password(new)
            user.save()
            # Re-authenticate the session so the user isn't logged out
            from core.account_auth import account_session_login
            account_session_login(request, user)
            success = True

    context = {
        **account_site.each_context(request),
        "title": "Change password",
        "error": error,
        "success": success,
    }
    return render(request, "account/change_password_page.html", context)


@account_login_required
def account_system_view(request: HttpRequest) -> HttpResponse:
    import sys
    import django
    from core.models import PushSubscription
    from core.services.push import get_public_push_config

    uptime_str = "unavailable"
    try:
        with open("/proc/uptime") as f:
            boot_seconds = float(f.read().split()[0])
        proc_start_ticks = int(open("/proc/self/stat").read().split()[21])
        clock_ticks = os.sysconf("SC_CLK_TCK")
        proc_uptime_seconds = boot_seconds - (proc_start_ticks / clock_ticks)
        uptime = datetime.timedelta(seconds=int(proc_uptime_seconds))
        hours, remainder = divmod(int(uptime.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        uptime_str = f"{hours}h {minutes}m {seconds}s"
    except Exception:
        pass

    device_count = Device.objects.filter(is_active=True).exclude(name=_SYSTEM_DEVICE_NAME).count()
    push_subs = PushSubscription.objects.select_related("device").order_by("-updated_at")

    context = {
        **account_site.each_context(request),
        "title": "System info",
        "uptime": uptime_str,
        "python_version": sys.version.split()[0],
        "django_version": django.__version__,
        "device_count": device_count,
        "push_config": get_public_push_config(),
        "push_subs": push_subs,
    }
    return render(request, "account/system_page.html", context)
