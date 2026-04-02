import json
import logging

from django.conf import settings
from django.utils import timezone

from core.models import Device, PushSubscription

logger = logging.getLogger(__name__)

try:
    from pywebpush import WebPushException, webpush
except ImportError:  # pragma: no cover - optional at runtime
    WebPushException = Exception
    webpush = None


def push_is_configured() -> bool:
    return bool(
        settings.LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY
        and settings.LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY
        and webpush is not None
    )


def get_public_push_config() -> dict:
    return {
        "supported": push_is_configured(),
        "vapid_public_key": settings.LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY if push_is_configured() else "",
    }


def upsert_push_subscription(
    *,
    device: Device,
    endpoint: str,
    p256dh: str,
    auth_secret: str,
    user_agent: str = "",
) -> PushSubscription:
    subscription, _ = PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={
            "device": device,
            "p256dh": p256dh,
            "auth_secret": auth_secret,
            "user_agent": user_agent[:255],
            "is_active": True,
            "last_error": "",
        },
    )
    return subscription


def deactivate_push_subscription(*, device: Device, endpoint: str) -> int:
    return PushSubscription.objects.filter(
        device=device,
        endpoint=endpoint,
        is_active=True,
    ).update(
        is_active=False,
        updated_at=timezone.now(),
    )


def _send_to_subscriptions(*, device: Device, payload: str, subscriptions) -> dict:
    """Send a push payload to a queryset of subscriptions. Returns delivery stats."""
    delivered = 0
    total = 0

    for subscription in subscriptions:
        total += 1
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {
                        "p256dh": subscription.p256dh,
                        "auth": subscription.auth_secret,
                    },
                },
                data=payload,
                vapid_private_key=settings.LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.LINKHOP_WEBPUSH_VAPID_SUBJECT},
            )
        except WebPushException as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            subscription.last_failure_at = timezone.now()
            subscription.last_error = str(exc)[:255]
            if status_code in {404, 410}:
                subscription.is_active = False
            subscription.save(
                update_fields=[
                    "last_failure_at",
                    "last_error",
                    "is_active",
                    "updated_at",
                ]
            )
            logger.warning("Push delivery failed for %s: %s", subscription.endpoint, exc)
            continue

        delivered += 1
        now = timezone.now()
        subscription.last_success_at = now
        subscription.last_error = ""
        subscription.save(update_fields=["last_success_at", "last_error", "updated_at"])
        Device.objects.filter(id=device.id).update(last_push_at=now)

    return {"delivered": delivered, "total": total}


def relay_push_message(
    *,
    device: Device,
    message_id: str,
    message_type: str,
    body: str,
    sender_name: str,
    recipient_device_id: str,
    created_at: str,
    is_test: bool = False,
) -> dict:
    """Relay a message to a device via Web Push. Returns delivery stats."""
    if not push_is_configured():
        return {"delivered": 0, "total": 0}

    payload = json.dumps(
        {
            "message_id": message_id,
            "type": message_type,
            "body": body,
            "sender": sender_name,
            "recipient_device_id": recipient_device_id,
            "created_at": created_at,
            **({"test": True} if is_test else {}),
        }
    )

    subscriptions = PushSubscription.objects.filter(device=device, is_active=True)
    return _send_to_subscriptions(device=device, payload=payload, subscriptions=subscriptions)
