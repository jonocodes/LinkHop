from datetime import datetime, timedelta
from typing import Optional

from django.utils import timezone

from core.models import Device
from core.services.auth import _SYSTEM_DEVICE_NAME


def list_active_devices(user=None):
    qs = Device.objects.filter(is_active=True, revoked_at__isnull=True).exclude(name=_SYSTEM_DEVICE_NAME)
    if user is not None:
        qs = qs.filter(owner=user)
    return qs.order_by("name")


RECENT_THRESHOLD_SECONDS = 300  # 5 minutes


def device_presence_status(device: Device) -> str:
    """Return 'recent' or 'offline'.

    'recent'  — last activity within RECENT_THRESHOLD_SECONDS
    'offline' — not seen within threshold (or never)
    """
    last_active = device.last_active_at
    if last_active is not None:
        age = (timezone.now() - last_active).total_seconds()
        if age <= RECENT_THRESHOLD_SECONDS:
            return "recent"
    return "offline"


def format_time_ago(dt: Optional[datetime]) -> str:
    """Format a datetime as a human-readable 'time ago' string."""
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
