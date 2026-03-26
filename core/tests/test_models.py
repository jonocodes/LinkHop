from django.core.exceptions import ValidationError
from django.test import TestCase

from core.models import Device, Message, MessageType


class MessageModelTests(TestCase):
    def setUp(self):
        self.sender = Device.objects.create(name="Sender", token_hash="hash-sender")
        self.recipient = Device.objects.create(name="Recipient", token_hash="hash-recipient")

    def _message(self, **kwargs):
        defaults = dict(
            sender_device=self.sender,
            recipient_device=self.recipient,
            type=MessageType.TEXT,
            body="hello",
            expires_at=Message.default_expiry(),
        )
        defaults.update(kwargs)
        return Message(**defaults)

    def test_url_message_requires_absolute_http_or_https_url(self):
        message = self._message(type=MessageType.URL, body="ftp://example.com")
        with self.assertRaises(ValidationError):
            message.full_clean()

    def test_text_message_cannot_be_blank(self):
        message = self._message(body="   ")
        with self.assertRaises(ValidationError):
            message.full_clean()

    def test_valid_text_message_passes_validation(self):
        message = self._message(body="hello\nworld")
        message.full_clean()
