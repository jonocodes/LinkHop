from datetime import datetime, timedelta
from typing import Optional

from django.utils import timezone

from core.models import Device
from core.services.auth import _SYSTEM_DEVICE_NAME


def list_active_devices():
    return Device.objects.filter(is_active=True, revoked_at__isnull=True).exclude(name=_SYSTEM_DEVICE_NAME).order_by("name")


def is_device_online(device: Device) -> bool:
    from core.sse import active_stream_count
    return active_stream_count(str(device.id)) > 0


ONLINE_THRESHOLD_SECONDS = 25


def device_presence_status(device: Device) -> str:
    """Return 'online', 'recent', or 'offline'.

    'online'  — active SSE stream right now
    'recent'  — no active stream but seen within ONLINE_THRESHOLD_SECONDS
    'offline' — not seen within threshold (or never)
    """
    from core.sse import active_stream_count
    if active_stream_count(str(device.id)) > 0:
        return "online"
    if device.last_seen_at is not None:
        age = (timezone.now() - device.last_seen_at).total_seconds()
        if age <= ONLINE_THRESHOLD_SECONDS:
            return "recent"
    return "offline"


def format_time_ago(dt: Optional[datetime]) -> str:
    """Format a datetime as a human-readable 'time ago' string.
    
    Examples:
        - Just now (< 1 min)
        - 2 minutes ago
        - 1 hour ago
        - 3 days ago
        - 2 weeks ago
        - Never (if dt is None)
    """
    if dt is None:
        return "Never"
    
    now = timezone.now()
    diff = now - dt
    
    if diff < timedelta(minutes=1):
        return "Just now"
    elif diff < timedelta(hours=1):
        minutes = int(diff.seconds / 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    elif diff < timedelta(days=1):
        hours = int(diff.seconds / 3600)
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    elif diff < timedelta(days=7):
        days = diff.days
        return f"{days} day{'s' if days != 1 else ''} ago"
    elif diff < timedelta(days=30):
        weeks = int(diff.days / 7)
        return f"{weeks} week{'s' if weeks != 1 else ''} ago"
    elif diff < timedelta(days=365):
        months = int(diff.days / 30)
        return f"{months} month{'s' if months != 1 else ''} ago"
    else:
        years = int(diff.days / 365)
        return f"{years} year{'s' if years != 1 else ''} ago"
