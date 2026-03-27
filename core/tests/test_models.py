from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from core.models import Device, Message, MessageType, GlobalSettings


class DeviceModelTests(TestCase):
    def test_device_creation(self):
        device = Device.objects.create(name="Test Device", token_hash="test-hash-123")
        self.assertEqual(device.name, "Test Device")
        self.assertTrue(device.is_active)
        self.assertIsNone(device.revoked_at)
        self.assertIsNone(device.last_seen_at)

    def test_device_name_uniqueness(self):
        Device.objects.create(name="Unique Device", token_hash="hash-1")
        with self.assertRaises(Exception):  # IntegrityError
            Device.objects.create(name="Unique Device", token_hash="hash-2")

    def test_device_revocation(self):
        device = Device.objects.create(name="Revokable", token_hash="hash-rev")
        self.assertIsNone(device.revoked_at)
        device.revoked_at = timezone.now()
        device.save()
        device.refresh_from_db()
        self.assertIsNotNone(device.revoked_at)

    def test_device_token_hash_uniqueness(self):
        Device.objects.create(name="Device 1", token_hash="unique-hash")
        with self.assertRaises(Exception):  # IntegrityError
            Device.objects.create(name="Device 2", token_hash="unique-hash")

    def test_device_str_representation(self):
        device = Device.objects.create(name="My Device", token_hash="hash")
        self.assertEqual(str(device), "My Device")

    def test_device_timestamps(self):
        device = Device.objects.create(name="Timestamp Device", token_hash="hash-ts")
        self.assertIsNotNone(device.created_at)
        self.assertIsNotNone(device.updated_at)


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

    def test_message_str_representation(self):
        message = self._message()
        message.save()
        self.assertEqual(str(message), f"text:{message.id}")

    def test_message_is_expired(self):
        message = self._message()
        message.save()
        self.assertFalse(message.is_expired)
        message.expires_at = timezone.now() - timezone.timedelta(days=1)
        message.save()
        self.assertTrue(message.is_expired)
