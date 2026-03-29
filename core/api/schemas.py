import uuid
from datetime import datetime

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from ninja import Schema


class ErrorSchema(Schema):
    code: str
    message: str


class ErrorResponseSchema(Schema):
    error: ErrorSchema


class RegisterDeviceIn(Schema):
    enrollment_token: str
    device_name: str
    platform_label: str = ""
    app_version: str = ""


class DeviceSchema(Schema):
    id: uuid.UUID
    name: str
    is_active: bool
    last_seen_at: datetime | None = None


class RegisterDeviceOut(Schema):
    device: DeviceSchema
    token: str


class PairingPinOut(Schema):
    pin: str
    expires_at: datetime


class RegisterWithPinIn(Schema):
    pin: str
    device_name: str
    platform_label: str = ""
    app_version: str = ""


class DeviceListItemSchema(DeviceSchema):
    is_online: bool


class PushConfigSchema(Schema):
    supported: bool
    vapid_public_key: str


class PushSubscriptionKeysIn(Schema):
    p256dh: str
    auth: str


class PushSubscriptionIn(Schema):
    endpoint: str
    keys: PushSubscriptionKeysIn


class PushSubscriptionDeleteIn(Schema):
    endpoint: str


class CreateMessageIn(Schema):
    recipient_device_id: uuid.UUID
    type: str
    body: str

    @staticmethod
    def validate_type(value: str) -> str:
        if value not in ("url", "text"):
            raise ValidationError("Message type must be 'url' or 'text'.")
        return value

    @staticmethod
    def validate_body(value: str, values: dict) -> str:
        msg_type = values.get("type", "url")

        if msg_type == "url":
            if len(value) > settings.LINKHOP_MESSAGE_URL_MAX_LENGTH:
                raise ValidationError(
                    f"URL must be <= {settings.LINKHOP_MESSAGE_URL_MAX_LENGTH} characters."
                )
            validator = URLValidator(schemes=["http", "https"])
            try:
                validator(value)
            except ValidationError as exc:
                raise ValidationError(
                    "Must be a valid absolute http or https URL."
                ) from exc
        elif msg_type == "text":
            if not value.strip():
                raise ValidationError("Text messages cannot be blank.")
            if len(value) > settings.LINKHOP_MESSAGE_TEXT_MAX_LENGTH:
                raise ValidationError(
                    f"Text must be <= {settings.LINKHOP_MESSAGE_TEXT_MAX_LENGTH} characters."
                )

        return value


class MessageSchema(Schema):
    id: uuid.UUID
    sender_device_id: uuid.UUID | None = None
    recipient_device_id: uuid.UUID
    type: str
    body: str
    status: str
    created_at: datetime
    expires_at: datetime
    received_at: datetime | None = None
    presented_at: datetime | None = None
    opened_at: datetime | None = None
