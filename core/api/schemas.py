import uuid
from datetime import datetime

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


class DeviceListItemSchema(DeviceSchema):
    is_online: bool


class CreateMessageIn(Schema):
    recipient_device_id: uuid.UUID
    type: str
    body: str


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
