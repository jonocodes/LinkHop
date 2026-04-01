from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from django.utils import timezone

from core.models import Device, GlobalSettings, Message, MessageType, PairingPin, PushSubscription
from core.services.auth import create_pairing_pin, register_device_with_pairing_pin
from core.services.push import relay_push_message, upsert_push_subscription


class DeviceModelTests(TestCase):
    def test_device_creation(self):
        device = Device.objects.create(name="Test Device", token_hash="test-hash-123")
        self.assertEqual(device.name, "Test Device")
        self.assertTrue(device.is_active)
        self.assertIsNone(device.revoked_at)
        self.assertIsNone(device.last_seen_at)

    def test_device_name_uniqueness_per_owner(self):
        from django.contrib.auth import get_user_model
        from django.db import IntegrityError
        User = get_user_model()
        user = User.objects.create_user(username="owner1", password="pass")
        Device.objects.create(name="My Device", token_hash="hash-1", owner=user)
        with self.assertRaises(IntegrityError):
            Device.objects.create(name="My Device", token_hash="hash-2", owner=user)

    def test_device_name_unique_across_owners(self):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user_a = User.objects.create_user(username="owner_a", password="pass")
        user_b = User.objects.create_user(username="owner_b", password="pass")
        Device.objects.create(name="laptop", token_hash="hash-a", owner=user_a)
        # Same name, different owner — should be allowed
        Device.objects.create(name="laptop", token_hash="hash-b", owner=user_b)

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


class PairingPinModelTests(TestCase):
    def test_pairing_pin_is_single_use(self):
        device = Device.objects.create(name="Issuer", token_hash="issuer-hash")
        _, raw_pin = create_pairing_pin(device=device)

        first = register_device_with_pairing_pin(raw_pin=raw_pin, name="First Device")
        second = register_device_with_pairing_pin(raw_pin=raw_pin, name="Second Device")

        self.assertIsNotNone(first)
        self.assertIsNone(second)

    def test_creating_new_pin_deletes_previous_unused_pin(self):
        device = Device.objects.create(name="Issuer", token_hash="issuer-hash")
        first_pin, _ = create_pairing_pin(device=device)
        _second_pin, _ = create_pairing_pin(device=device)

        self.assertFalse(PairingPin.objects.filter(id=first_pin.id).exists())
        self.assertEqual(PairingPin.objects.filter(created_by_device=device).count(), 1)


class PushSubscriptionModelTests(TestCase):
    def setUp(self):
        self.device = Device.objects.create(name="Push Device", token_hash="push-hash")

    def test_upsert_push_subscription_updates_existing_endpoint(self):
        first = upsert_push_subscription(
            device=self.device,
            endpoint="https://push.example.test/sub/123",
            p256dh="old-key",
            auth_secret="old-auth",
            user_agent="UA 1",
        )

        second = upsert_push_subscription(
            device=self.device,
            endpoint="https://push.example.test/sub/123",
            p256dh="new-key",
            auth_secret="new-auth",
            user_agent="UA 2",
        )

        self.assertEqual(first.id, second.id)
        second.refresh_from_db()
        self.assertEqual(second.p256dh, "new-key")
        self.assertEqual(second.auth_secret, "new-auth")
        self.assertEqual(second.user_agent, "UA 2")
        self.assertTrue(second.is_active)

    @override_settings(
        LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY="public-key",
        LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY="private-key",
        LINKHOP_WEBPUSH_VAPID_SUBJECT="mailto:admin@example.com",
    )
    def test_notify_push_subscription_records_success(self):
        subscription = PushSubscription.objects.create(
            device=self.device,
            endpoint="https://push.example.test/sub/success",
            p256dh="p256dh-key",
            auth_secret="auth-secret",
        )

        with patch("core.services.push.webpush") as mock_webpush:
            relay_push_message(
                device=self.device,
                message_id="test-msg-id",
                message_type="text",
                body="hello push",
                sender_name="Sender",
                recipient_device_id=str(self.device.id),
                created_at="2026-01-01T00:00:00Z",
            )

        subscription.refresh_from_db()
        self.assertIsNotNone(subscription.last_success_at)
        self.assertEqual(subscription.last_error, "")
        mock_webpush.assert_called_once()
        self.assertIn('"message_id"', mock_webpush.call_args.kwargs["data"])

    @override_settings(
        LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY="public-key",
        LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY="private-key",
        LINKHOP_WEBPUSH_VAPID_SUBJECT="mailto:admin@example.com",
    )
    def test_notify_push_subscription_deactivates_gone_endpoint(self):
        subscription = PushSubscription.objects.create(
            device=self.device,
            endpoint="https://push.example.test/sub/gone",
            p256dh="p256dh-key",
            auth_secret="auth-secret",
        )

        class FakeWebPushException(Exception):
            def __init__(self, message):
                super().__init__(message)
                self.response = SimpleNamespace(status_code=410)

        with patch("core.services.push.WebPushException", FakeWebPushException):
            with patch(
                "core.services.push.webpush",
                side_effect=FakeWebPushException("subscription gone"),
            ):
                relay_push_message(
                    device=self.device,
                    message_id="test-msg-id",
                    message_type="text",
                    body="hello push",
                    sender_name="Sender",
                    recipient_device_id=str(self.device.id),
                    created_at="2026-01-01T00:00:00Z",
                )

        subscription.refresh_from_db()
        self.assertFalse(subscription.is_active)
        self.assertIsNotNone(subscription.last_failure_at)
        self.assertIn("subscription gone", subscription.last_error)


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

    def test_message_expiry(self):
        message = self._message()
        message.save()
        self.assertGreater(message.expires_at, timezone.now())
