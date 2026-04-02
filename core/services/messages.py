import logging
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone

from core.models import Device, MessageType
from core.services.push import relay_push_message

logger = logging.getLogger(__name__)


def _get_global_settings():
    from core.models import GlobalSettings
    return GlobalSettings.objects.filter(singleton_key="default").first()


def _validate_message(*, message_type: str, body: str):
    """Validate message type and body without touching the database."""
    if message_type not in (MessageType.URL, MessageType.TEXT):
        raise ValidationError("Message type must be 'url' or 'text'.")

    if message_type == MessageType.URL:
        from django.core.validators import URLValidator
        max_len = getattr(settings, "LINKHOP_MESSAGE_URL_MAX_LENGTH", 2048)
        if len(body) > max_len:
            raise ValidationError(f"URL must be at most {max_len} characters.")
        validator = URLValidator(schemes=["http", "https"])
        try:
            validator(body)
        except ValidationError:
            raise ValidationError("body must be a valid absolute http or https URL")

    if message_type == MessageType.TEXT:
        max_len = getattr(settings, "LINKHOP_MESSAGE_TEXT_MAX_LENGTH", 3500)
        if len(body) > max_len:
            raise ValidationError(f"Text body must be at most {max_len} characters.")
        if not body or not body.strip():
            raise ValidationError("Text body cannot be empty.")


def relay_message(
    *,
    sender_device: Device,
    recipient_device: Device,
    message_type: str,
    body: str,
    _skip_self_send_check: bool = False,
) -> dict:
    """Validate and relay a message via Web Push. No server-side storage."""
    if not _skip_self_send_check and sender_device.id == recipient_device.id:
        gs = _get_global_settings()
        allow = gs.allow_self_send if gs is not None else False
        if not allow:
            raise ValidationError("Sending a message to yourself is not allowed.")

    _validate_message(message_type=message_type, body=body)

    message_id = str(uuid.uuid4())
    created_at = timezone.now().isoformat()

    push_result = relay_push_message(
        device=recipient_device,
        message_id=message_id,
        message_type=message_type,
        body=body,
        sender_name=sender_device.name,
        recipient_device_id=str(recipient_device.id),
        created_at=created_at,
    )

    # "ping server" auto-reply
    if message_type == MessageType.TEXT and body.strip().lower() == "ping server":
        relay_message(
            sender_device=recipient_device,
            recipient_device=sender_device,
            message_type=MessageType.TEXT,
            body="pong (server)",
        )

    logger.info(
        "message_relayed id=%s type=%s sender=%s recipient=%s push=%d/%d",
        message_id,
        message_type,
        sender_device.name,
        recipient_device.name,
        push_result["delivered"],
        push_result["total"],
    )

    return {
        "id": message_id,
        "type": message_type,
        "body": body,
        "sender_device_id": str(sender_device.id),
        "recipient_device_id": str(recipient_device.id),
        "created_at": created_at,
        "push_delivered": push_result["delivered"] > 0,
        "push_subscriptions": push_result["total"],
    }
