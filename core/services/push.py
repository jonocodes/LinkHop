import json
import logging

from django.conf import settings
from django.utils import timezone

from core.models import Device, Message, PushSubscription

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


def notify_device_push_subscriptions(*, device: Device, message: Message) -> None:
    if not push_is_configured():
        return

    payload = json.dumps(
        {
            "message_id": str(message.id),
            "type": message.type,
            "body": message.body,
            "sender": message.sender_device.name if message.sender_device_id else "unknown",
            "recipient_device_id": str(device.id),
        }
    )

    subscriptions = PushSubscription.objects.filter(device=device, is_active=True)
    for subscription in subscriptions:
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

        subscription.last_success_at = timezone.now()
        subscription.last_error = ""
        subscription.save(update_fields=["last_success_at", "last_error", "updated_at"])
