from django.core.cache import cache
from django.utils import timezone

from core.models import GlobalSettings


def _get_global_settings() -> GlobalSettings | None:
    return GlobalSettings.objects.filter(singleton_key="default").first()


def check_rate_limit(
    *,
    key: str,
    limit: int,
    window_seconds: int,
) -> bool:
    """
    Check if a request should be allowed based on rate limits.

    Returns True if the request is allowed (within limit), False otherwise.
    """
    cache_key = f"ratelimit:{key}"
    count = cache.get_or_set(cache_key, 0, timeout=window_seconds)
    
    if count >= limit:
        return False
    
    cache.incr(cache_key)
    return True


def check_sends_rate_limit(*, device_id: str) -> tuple[bool, int]:
    """
    Check if device is within rate limits for sending messages.

    Returns (allowed, limit_per_minute).
    """
    gs = _get_global_settings()
    limit = gs.api_sends_per_minute if gs else 30
    
    now = timezone.now()
    window_key = now.replace(second=0, microsecond=0).isoformat()
    key = f"send:{device_id}:{window_key}"
    
    allowed = check_rate_limit(
        key=key,
        limit=limit,
        window_seconds=60,
    )
    return allowed, limit


def check_confirmation_rate_limit(*, device_id: str) -> tuple[bool, int]:
    """
    Check if device is within rate limits for confirmation endpoints.

    Returns (allowed, limit_per_minute).
    """
    gs = _get_global_settings()
    limit = gs.api_confirmations_per_minute if gs else 120
    
    now = timezone.now()
    window_key = now.replace(second=0, microsecond=0).isoformat()
    key = f"confirm:{device_id}:{window_key}"
    
    allowed = check_rate_limit(
        key=key,
        limit=limit,
        window_seconds=60,
    )
    return allowed, limit


def check_registration_rate_limit(*, ip_address: str) -> tuple[bool, int]:
    """
    Check if IP is within rate limits for device registration.

    Returns (allowed, limit_per_hour).
    """
    gs = _get_global_settings()
    limit = gs.api_registrations_per_hour if gs else 10
    
    now = timezone.now()
    window_key = now.replace(minute=0, second=0, microsecond=0).isoformat()
    key = f"register:{ip_address}:{window_key}"
    
    allowed = check_rate_limit(
        key=key,
        limit=limit,
        window_seconds=3600,
    )
    return allowed, limit


def get_client_ip(request) -> str:
    """
    Extract client IP address from request.
    """
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "unknown")
