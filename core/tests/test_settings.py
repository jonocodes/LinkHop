from django.test import TestCase

from core.models import GlobalSettings


class GlobalSettingsTests(TestCase):
    def test_singleton_creation(self):
        """Test that we can create a singleton GlobalSettings instance."""
        settings = GlobalSettings.objects.create(
            singleton_key="default",
            message_retention_days=7,
            api_sends_per_minute=30,
            api_confirmations_per_minute=120,
            api_registrations_per_hour=10,
            max_sse_streams_per_device=5,
            max_pending_messages=500,
            allow_self_send=False,
        )
        self.assertEqual(settings.singleton_key, "default")
        self.assertEqual(settings.message_retention_days, 7)
        self.assertTrue(settings.id)

    def test_default_values(self):
        """Test that default values are applied correctly."""
        settings = GlobalSettings.objects.create(singleton_key="default")
        self.assertEqual(settings.message_retention_days, 7)  # From settings
        self.assertEqual(settings.api_sends_per_minute, 30)
        self.assertEqual(settings.api_confirmations_per_minute, 120)
        self.assertEqual(settings.api_registrations_per_hour, 10)
        self.assertEqual(settings.max_sse_streams_per_device, 5)
        self.assertEqual(settings.max_pending_messages, 500)
        self.assertFalse(settings.allow_self_send)

    def test_singleton_key_uniqueness(self):
        """Test that singleton key must be unique."""
        GlobalSettings.objects.create(singleton_key="default")
        with self.assertRaises(Exception):  # IntegrityError
            GlobalSettings.objects.create(singleton_key="default")

    def test_allow_self_send_toggle(self):
        """Test toggling the allow_self_send setting."""
        settings = GlobalSettings.objects.create(singleton_key="default")
        self.assertFalse(settings.allow_self_send)

        settings.allow_self_send = True
        settings.save()
        settings.refresh_from_db()

        self.assertTrue(settings.allow_self_send)

    def test_str_representation(self):
        """Test the string representation."""
        settings = GlobalSettings.objects.create(singleton_key="default")
        self.assertEqual(str(settings), "Global Settings")

    def test_timestamps(self):
        """Test that timestamps are set."""
        settings = GlobalSettings.objects.create(singleton_key="default")
        self.assertIsNotNone(settings.created_at)
        self.assertIsNotNone(settings.updated_at)
