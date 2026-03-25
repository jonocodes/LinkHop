from core.models import Device, Event, Message


def create_event(
    *,
    event_type: str,
    device: Device | None = None,
    message: Message | None = None,
    metadata: dict | None = None,
) -> Event:
    return Event.objects.create(
        event_type=event_type,
        device=device,
        message=message,
        metadata_json=metadata or {},
    )
