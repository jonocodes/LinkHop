"""
Server-Sent Events endpoint.

Uses an async generator so the event loop is never blocked between polls.
Each `asyncio.sleep` yields control back to uvicorn, keeping the server
responsive and allowing clean Ctrl+C shutdown via CancelledError.
"""

import asyncio
import json
import threading
import time

from asgiref.sync import sync_to_async
from django.conf import settings
from django.http import HttpRequest, HttpResponse, StreamingHttpResponse
from django.utils import timezone

from core.models import Device, Message, MessageStatus
from core.services.auth import get_device_for_token

# ---------------------------------------------------------------------------
# In-process stream counter (used by is_device_online)
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_active_streams: dict[str, int] = {}


def increment_stream_count(device_id: str) -> int:
    with _lock:
        n = _active_streams.get(device_id, 0) + 1
        _active_streams[device_id] = n
        return n


def decrement_stream_count(device_id: str) -> None:
    with _lock:
        n = max(_active_streams.get(device_id, 1) - 1, 0)
        if n == 0:
            _active_streams.pop(device_id, None)
        else:
            _active_streams[device_id] = n


def active_stream_count(device_id: str) -> int:
    with _lock:
        return _active_streams.get(device_id, 0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@sync_to_async
def _authenticate(request: HttpRequest) -> Device | None:
    from core.device_auth import COOKIE_NAME
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        raw_token = auth_header.removeprefix("Bearer ").strip()
    else:
        raw_token = (
            request.GET.get("token")
            or request.COOKIES.get(COOKIE_NAME)
            or ""
        )
    if not raw_token:
        return None
    return get_device_for_token(raw_token)


@sync_to_async
def _update_last_seen(device: Device) -> None:
    device.last_seen_at = timezone.now()
    device.save(update_fields=["last_seen_at", "updated_at"])


@sync_to_async
def _update_device_info(device: Device, client_type: str, ua_string: str) -> None:
    from core.ua import parse_ua
    browser, os_str = parse_ua(ua_string)
    fields = ["updated_at"]
    if client_type:
        device.device_type = client_type
        fields.append("device_type")
    if browser:
        device.browser = browser
        fields.append("browser")
    if os_str:
        device.os = os_str
        fields.append("os")
    if len(fields) > 1:
        device.save(update_fields=fields)



@sync_to_async
def _get_pending_ids(device: Device) -> list[str]:
    ids = (
        Message.objects.filter(
            recipient_device=device,
            expires_at__gt=timezone.now(),
        )
        .exclude(status=MessageStatus.OPENED)
        .order_by("created_at")
        .values_list("id", flat=True)
    )
    return [str(i) for i in ids]


# ---------------------------------------------------------------------------
# Async generator
# ---------------------------------------------------------------------------

async def _stream(device: Device):
    device_id = str(device.id)

    n = increment_stream_count(device_id)
    if n > settings.LINKHOP_MAX_SSE_STREAMS_PER_DEVICE:
        decrement_stream_count(device_id)
        yield _sse("error", {"code": "too_many_streams",
                              "message": "Too many active streams for this device."})
        return

    await _update_last_seen(device)

    try:
        yield _sse("hello", {"device_id": device_id})

        known_ids: set[str] = set()
        ping_interval = 15
        last_ping = time.monotonic()

        while True:
            current_ids = await _get_pending_ids(device)
            for mid in current_ids:
                if mid not in known_ids:
                    known_ids.add(mid)
                    yield _sse("message", {"message_id": mid})

            if time.monotonic() - last_ping >= ping_interval:
                yield _sse("ping", {})
                last_ping = time.monotonic()
                await _update_last_seen(device)

            await asyncio.sleep(2)

    finally:
        decrement_stream_count(device_id)


# ---------------------------------------------------------------------------
# View
# ---------------------------------------------------------------------------

async def sse_view(request: HttpRequest) -> HttpResponse:
    device = await _authenticate(request)
    if device is None:
        return HttpResponse("Unauthorized", status=401, content_type="text/plain")

    client_type = request.GET.get("client_type", "").strip()[:20]
    ua_string = request.META.get("HTTP_USER_AGENT", "")
    await _update_device_info(device, client_type, ua_string)

    response = StreamingHttpResponse(_stream(device), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response
