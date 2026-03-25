from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from core.models import Device, Message, MessageStatus
from core.services.events import create_event


@transaction.atomic
def create_message(
    *,
    sender_device: Device,
    recipient_device: Device,
    message_type: str,
    body: str,
) -> Message:
    pending_count = Message.objects.filter(
        recipient_device=recipient_device,
        status__in=[MessageStatus.QUEUED, MessageStatus.RECEIVED, MessageStatus.PRESENTED],
        expires_at__gt=timezone.now(),
    ).count()
    if pending_count >= settings.LINKHOP_MAX_PENDING_MESSAGES:
        raise ValidationError("Recipient has too many pending messages.")

    message = Message(
        sender_device=sender_device,
        recipient_device=recipient_device,
        type=message_type,
        body=body,
        expires_at=Message.default_expiry(),
    )
    message.full_clean()
    message.save()
    create_event(
        event_type="message.created",
        device=sender_device,
        message=message,
        metadata={"recipient_device_id": str(recipient_device.id)},
    )
    return message


def list_incoming_messages(*, device: Device):
    return Message.objects.filter(
        recipient_device=device,
        expires_at__gt=timezone.now(),
    ).order_by("created_at")


def _get_owned_message(*, device: Device, message_id) -> Message:
    try:
        message = Message.objects.get(id=message_id)
    except Message.DoesNotExist as exc:
        raise ValidationError("Message not found.") from exc

    if message.recipient_device_id != device.id:
        raise PermissionDenied("Message does not belong to this device.")
    return message


@transaction.atomic
def mark_message_received(*, device: Device, message_id) -> Message:
    message = _get_owned_message(device=device, message_id=message_id)
    dirty_fields = set()

    if message.received_at is None:
        message.received_at = timezone.now()
        dirty_fields.add("received_at")
    if message.status == MessageStatus.QUEUED:
        message.status = MessageStatus.RECEIVED
        dirty_fields.add("status")

    if dirty_fields:
        message.save(update_fields=[*dirty_fields, "updated_at"])
        create_event(event_type="message.received", device=device, message=message)
    return message


@transaction.atomic
def mark_message_presented(*, device: Device, message_id) -> Message:
    message = _get_owned_message(device=device, message_id=message_id)
    dirty_fields = set()

    if message.received_at is None:
        message.received_at = timezone.now()
        dirty_fields.add("received_at")

    if message.presented_at is None:
        message.presented_at = timezone.now()
        dirty_fields.add("presented_at")

    if message.status in [MessageStatus.QUEUED, MessageStatus.RECEIVED]:
        message.status = MessageStatus.PRESENTED
        dirty_fields.add("status")

    if dirty_fields:
        message.save(update_fields=[*dirty_fields, "updated_at"])
        create_event(event_type="message.presented", device=device, message=message)
    return message


@transaction.atomic
def mark_message_opened(*, device: Device, message_id) -> Message:
    message = _get_owned_message(device=device, message_id=message_id)
    dirty_fields = set()

    if message.received_at is None:
        message.received_at = timezone.now()
        dirty_fields.add("received_at")
    if message.presented_at is None:
        message.presented_at = timezone.now()
        dirty_fields.add("presented_at")
    if message.opened_at is None:
        message.opened_at = timezone.now()
        dirty_fields.add("opened_at")
    if message.status != MessageStatus.OPENED:
        message.status = MessageStatus.OPENED
        dirty_fields.add("status")

    if dirty_fields:
        message.save(update_fields=[*dirty_fields, "updated_at"])
        create_event(event_type="message.opened", device=device, message=message)
    return message
