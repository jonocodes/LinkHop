from types import SimpleNamespace
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from django.utils import timezone

from core.models import Device, GlobalSettings, PushSubscription
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


class PushSubscriptionModelTests(TestCase):
    def setUp(self):
        self.device = Device.objects.create(name="Push Device", token_hash="push-hash")

    def test_upsert_push_subscription_updates_existing_endpoint(self):
        first = upsert_push_subscription(
            device=self.device,
            endpoint="https://push.example.test/sub/123",
            p256dh="old-key",
            auth_secret="old-auth",
            client_type="browser",
            user_agent="UA 1",
        )

        second = upsert_push_subscription(
            device=self.device,
            endpoint="https://push.example.test/sub/123",
            p256dh="new-key",
            auth_secret="new-auth",
            client_type="extension",
            user_agent="UA 2",
        )

        self.assertEqual(first.id, second.id)
        second.refresh_from_db()
        self.assertEqual(second.p256dh, "new-key")
        self.assertEqual(second.auth_secret, "new-auth")
        self.assertEqual(second.client_type, "extension")
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

    @override_settings(
        LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY="public-key",
        LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY="private-key",
        LINKHOP_WEBPUSH_VAPID_SUBJECT="mailto:admin@example.com",
    )
    def test_extension_subscription_suppresses_browser_push_subscription(self):
        browser_sub = PushSubscription.objects.create(
            device=self.device,
            endpoint="https://push.example.test/sub/browser",
            p256dh="browser-key",
            auth_secret="browser-secret",
            client_type="browser",
        )
        extension_sub = PushSubscription.objects.create(
            device=self.device,
            endpoint="https://push.example.test/sub/extension",
            p256dh="extension-key",
            auth_secret="extension-secret",
            client_type="extension",
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

        self.assertEqual(mock_webpush.call_count, 1)
        payload = mock_webpush.call_args.kwargs["subscription_info"]
        self.assertEqual(payload["endpoint"], extension_sub.endpoint)
        browser_sub.refresh_from_db()
        extension_sub.refresh_from_db()
        self.assertIsNone(browser_sub.last_success_at)
        self.assertIsNotNone(extension_sub.last_success_at)

