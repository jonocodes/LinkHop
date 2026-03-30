from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from unittest.mock import patch

from core.models import GlobalSettings

User = get_user_model()


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


class AdminSettingsViewTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )
        self.client.force_login(self.admin)

    def _account_login(self, user=None):
        """Log into the account dashboard via the account session (separate from admin auth)."""
        from core.account_auth import SESSION_KEY
        u = user or self.admin
        session = self.client.session
        session[SESSION_KEY] = u.pk
        session.save()

    def test_admin_settings_page_auto_creates_singleton(self):
        response = self.client.get(reverse("admin_settings"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Save settings")
        self.assertTrue(GlobalSettings.objects.filter(singleton_key="default").exists())

    def test_admin_settings_page_updates_values(self):
        response = self.client.post(
            reverse("admin_settings"),
            data={
                "message_retention_days": 14,
                "api_sends_per_minute": 40,
                "api_confirmations_per_minute": 150,
                "api_registrations_per_hour": 12,
                "max_sse_streams_per_device": 7,
                "max_pending_messages": 750,
                "allow_self_send": "on",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], reverse("admin_settings"))

        settings = GlobalSettings.objects.get(singleton_key="default")
        self.assertEqual(settings.message_retention_days, 14)
        self.assertEqual(settings.api_sends_per_minute, 40)
        self.assertEqual(settings.api_confirmations_per_minute, 150)
        self.assertEqual(settings.api_registrations_per_hour, 12)
        self.assertEqual(settings.max_sse_streams_per_device, 7)
        self.assertEqual(settings.max_pending_messages, 750)
        self.assertTrue(settings.allow_self_send)

    def test_global_settings_admin_redirects_to_settings_page(self):
        response = self.client.get("/admin/core/globalsettings/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], reverse("admin_settings"))

    @patch("core.admin._admin_has_unapplied_migrations", return_value=True)
    def test_admin_settings_page_shows_migration_warning(self, _mock_has_unapplied_migrations):
        response = self.client.get(reverse("admin_settings"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Database migrations are pending.")
        self.assertContains(response, "manage.py migrate")

    def test_admin_index_shows_management_section_with_global_settings(self):
        response = self.client.get("/admin/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Management")
        self.assertContains(response, "Global settings")
        self.assertContains(response, reverse("admin_settings"))

    def test_admin_index_does_not_show_bookmarklet_in_management(self):
        response = self.client.get("/admin/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Management")
        self.assertNotContains(response, reverse("account_bookmarklet"))

    def test_account_connected_devices_page_has_add_device_button(self):
        self._account_login()
        response = self.client.get(reverse("account_connected_devices"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Add device")
        self.assertContains(response, reverse("account_add_device"))
        self.assertContains(response, reverse("account_bookmarklet"))

    def test_account_add_device_page_creates_pin(self):
        self._account_login()
        # POST redirects back to the page (PRG pattern); follow to get the registration link display
        response = self.client.post(reverse("account_add_device"), follow=True)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Registration link")
        self.assertContains(response, "Cancel registration")
        self.assertContains(response, 'id="pairing-countdown"')

    def test_account_bookmarklet_page_renders_drag_link(self):
        self._account_login()
        response = self.client.get(reverse("account_bookmarklet"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Send with LinkHop")
        self.assertContains(response, "javascript:")
        self.assertContains(response, "/hop")
        self.assertContains(response, 'draggable="true"')


class AccountNonAdminViewTests(TestCase):
    """Tests account views when request.user is anonymous (no force_login).

    This reproduces the real-world case where a regular user logs in via
    /account/login/ only — request.user is AnonymousUser, account session holds
    the user. Unfold templates must not crash on an empty username.
    """

    def setUp(self):
        from core.account_auth import SESSION_KEY
        self.user = User.objects.create_user(
            username="alice", password="pass", email="alice@example.com"
        )
        session = self.client.session
        session[SESSION_KEY] = self.user.pk
        session.save()
        # Intentionally no force_login — request.user stays anonymous.

    def test_connected_devices_page_renders_for_non_admin_account_user(self):
        response = self.client.get(reverse("account_connected_devices"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Add device")

    def test_add_device_page_renders_for_non_admin_account_user(self):
        response = self.client.get(reverse("account_add_device"))
        self.assertEqual(response.status_code, 200)

    def test_bookmarklet_page_renders_for_non_admin_account_user(self):
        response = self.client.get(reverse("account_bookmarklet"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "javascript:")
