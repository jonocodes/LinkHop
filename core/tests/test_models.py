from django.core.exceptions import ValidationError
from django.test import TestCase

from core.models import Device, Message, MessageType


class MessageModelTests(TestCase):
    def setUp(self):
        self.device = Device.objects.create(name="Recipient", token_hash="hash")

    def test_url_message_requires_absolute_http_or_https_url(self):
        message = Message(
            recipient_device=self.device,
            type=MessageType.URL,
            body="ftp://example.com",
            expires_at=Message.default_expiry(),
        )

        with self.assertRaises(ValidationError):
            message.full_clean()

    def test_text_message_cannot_be_blank(self):
        message = Message(
            recipient_device=self.device,
            type=MessageType.TEXT,
            body="   ",
            expires_at=Message.default_expiry(),
        )

        with self.assertRaises(ValidationError):
            message.full_clean()

    def test_valid_text_message_passes_validation(self):
        message = Message(
            recipient_device=self.device,
            type=MessageType.TEXT,
            body="hello\nworld",
            expires_at=Message.default_expiry(),
        )

        message.full_clean()
