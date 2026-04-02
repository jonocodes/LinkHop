"""
End-to-End Tests for LinkHop

These tests verify the complete user flow from blank environment to message relay.
Messages are no longer stored in the database; the server is a stateless relay via Web Push.
"""
import json

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from core.device_auth import COOKIE_NAME
from core.models import Device
from core.services.auth import create_device_token

User = get_user_model()

PATCH_RELAY = patch(
    "core.services.push.relay_push_message",
    return_value={"delivered": 0, "total": 0},
)


@override_settings(ALLOWED_HOSTS=["localhost", "127.0.0.1", "testserver"])
class EndToEndTestCase(TestCase):
    """
    End-to-end tests using Django test client.

    Tests the complete flow:
    - Start blank environment
    - Bootstrap admin
    - Register devices
    - Relay messages via Web Push
    """

    def setUp(self):
        cache.clear()
        # Start with blank environment (no devices, no users)
        self.assertEqual(Device.objects.count(), 0)
        self.assertEqual(User.objects.count(), 0)

    def _connect_device(self, raw_token, client=None):
        """Set the device cookie directly on a test client."""
        client = client or self.client
        client.cookies[COOKIE_NAME] = raw_token

    def _account_login(self, user, client=None):
        """Log into the account dashboard via the account session key."""
        from core.account_auth import SESSION_KEY
        client = client or self.client
        session = client.session
        session[SESSION_KEY] = user.pk
        session.save()

    def _setup_account_and_device(self, username="testuser", password="testpass", device_name="Test Device"):
        """Create user, log into account, register a device via the activate page."""
        user = User.objects.create_user(username=username, password=password)
        self._account_login(user)
        response = self.client.post(
            "/account/activate-device/",
            data={"device_name": device_name},
        )
        device = Device.objects.get(name=device_name)
        # The response sets a cookie — transfer it to the test client
        if response.cookies.get(COOKIE_NAME):
            self.client.cookies[COOKIE_NAME] = response.cookies[COOKIE_NAME].value
        return user, device

    def test_blank_environment_starts_clean(self):
        """Verify that we start with a blank environment."""
        self.assertEqual(Device.objects.count(), 0)
        self.assertEqual(User.objects.count(), 0)

    def test_home_page_redirects_to_setup_when_no_superuser(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/setup/", response.url)

    def test_home_page_exposes_primary_links(self):
        User.objects.create_superuser(username="admin", password="adminpass")
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Log in")
        self.assertContains(response, "/admin/")
        self.assertContains(response, "https://github.com/jonocodes/LinkHop")

    def test_manifest_route_returns_pwa_metadata(self):
        response = self.client.get("/manifest.json")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["name"], "LinkHop")
        self.assertEqual(payload["start_url"], "/account/inbox/")
        self.assertEqual(payload["display"], "standalone")
        self.assertEqual(len(payload["icons"]), 2)

    def test_service_worker_route_returns_javascript(self):
        response = self.client.get("/service-worker.js")

        self.assertEqual(response.status_code, 200)
        self.assertIn("application/javascript", response.headers["Content-Type"])
        self.assertIn(b"CACHE_NAME", response.content)
        self.assertIn(b"/manifest.json", response.content)
        self.assertIn(b"linkhop_push_notified", response.content)
        self.assertIn(b"hasVisibleClient", response.content)
        self.assertIn(b"pushsubscriptionchange", response.content)
        self.assertIn(b"linkhop_push_auth", response.content)
        self.assertIn(b"linkhop_push_refresh_required", response.content)
        self.assertIn(b"/account/inbox/", response.content)

    def test_bootstrap_admin_creation(self):
        """Create an admin user to manage the system."""
        admin = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )
        self.assertTrue(admin.is_superuser)
        self.assertTrue(admin.is_staff)

    def test_auto_register_two_devices_via_api(self):
        """Register two devices entirely via automation."""
        device_a, device_a_token = create_device_token(name="Device A")
        device_a_id = str(device_a.id)

        device_b, device_b_token = create_device_token(name="Device B")
        device_b_id = str(device_b.id)

        # Verify both devices exist
        self.assertEqual(Device.objects.count(), 2)
        self.assertIsNotNone(Device.objects.get(id=device_a_id))
        self.assertIsNotNone(Device.objects.get(id=device_b_id))
        self.assertTrue(device_a_token.startswith("device_"))
        self.assertTrue(device_b_token.startswith("device_"))

    def test_device_can_list_other_active_devices(self):
        """Test that devices can list active devices as send targets."""
        device_a, device_a_token = create_device_token(name="Device A")

        device_b, device_b_token = create_device_token(name="Device B")
        device_b_id = str(device_b.id)

        # Device A lists devices
        response = self.client.get(
            "/api/devices",
            headers={"Authorization": f"Bearer {device_a_token}"},
        )
        self.assertEqual(response.status_code, 200)
        devices = response.json()
        self.assertEqual(len(devices), 2)

        # Device B should be in the list
        device_ids = [str(d["id"]) for d in devices]
        self.assertIn(device_b_id, device_ids)

    @PATCH_RELAY
    def test_self_send_prevented_by_default(self, mock_relay):
        """Test that devices cannot send messages to themselves by default."""
        device_a, device_a_token = create_device_token(name="Device A")
        device_a_id = str(device_a.id)

        # Try to send message to self
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": device_a_id,
                "type": "text",
                "body": "Message to self",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_a_token}"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("validation_error", response.json()["error"]["code"])

    @PATCH_RELAY
    def test_self_send_allowed_when_enabled(self, mock_relay):
        """Test that self-send works when enabled in global settings."""
        from core.models import GlobalSettings

        # Enable self-send
        GlobalSettings.objects.create(singleton_key="default", allow_self_send=True)

        device_a, device_a_token = create_device_token(name="Device A")
        device_a_id = str(device_a.id)

        # Now self-send should work
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": device_a_id,
                "type": "text",
                "body": "Message to self",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_a_token}"},
        )
        self.assertEqual(response.status_code, 201)

    def test_device_self_identification(self):
        """Test that a device can identify itself via API."""
        device, device_token = create_device_token(name="My Test Device")
        device_id = str(device.id)

        # Device identifies itself
        response = self.client.get(
            "/api/device/me",
            headers={"Authorization": f"Bearer {device_token}"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["name"], "My Test Device")
        self.assertEqual(str(data["id"]), device_id)
        self.assertTrue(data["is_active"])

    @PATCH_RELAY
    def test_revoked_device_cannot_authenticate(self, mock_relay):
        """Test that a revoked device cannot send or receive messages."""
        device_a, device_a_token = create_device_token(name="Device A")

        device_b, device_b_token = create_device_token(name="Device B")
        device_b_id = str(device_b.id)

        # Revoke Device B
        device_b.revoked_at = timezone.now()
        device_b.save()

        # Device A tries to send to revoked Device B
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": device_b_id,
                "type": "text",
                "body": "Message to revoked device",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_a_token}"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("recipient_not_found", response.json()["error"]["code"])

        # Revoked Device B cannot authenticate
        response = self.client.get(
            "/api/device/me",
            headers={"Authorization": f"Bearer {device_b_token}"},
        )
        self.assertEqual(response.status_code, 401)

    @PATCH_RELAY
    def test_admin_can_view_all_data(self, mock_relay):
        """Test that admin can view all devices."""
        # Create admin
        admin = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )

        # Register devices and send message
        device_a, device_a_token = create_device_token(name="Device A")
        device_a_id = str(device_a.id)

        device_b, device_b_token = create_device_token(name="Device B")
        device_b_id = str(device_b.id)

        # Send message (relayed, not stored)
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": device_b_id,
                "type": "text",
                "body": "Test message",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_a_token}"},
        )
        self.assertEqual(response.status_code, 201)

        # Verify admin can login and view data
        login_response = self.client.post(
            "/admin/login/",
            data={
                "username": "admin",
                "password": "adminpass123",
            },
        )
        # Admin login should work (even if it redirects)
        self.assertIn(login_response.status_code, [200, 302])

        # Verify devices exist in database
        self.assertEqual(Device.objects.count(), 2)

    def test_duplicate_device_name_rejected(self):
        """Test that duplicate device names are rejected within the same owner."""
        from django.contrib.auth import get_user_model
        from django.db import IntegrityError
        User = get_user_model()
        user = User.objects.create_user(username="dup_owner", password="pass")
        create_device_token(name="Same Name", owner=user)
        with self.assertRaises(IntegrityError):
            create_device_token(name="Same Name", owner=user)

    # ============================================================
    # WEB INTERFACE END-TO-END TESTS
    # ============================================================

    def test_activate_device_flow(self):
        """Test the complete account login + device registration + disconnect flow."""
        user = User.objects.create_user(username="webuser", password="webpass123")
        self._account_login(user)

        # Visit activate page
        response = self.client.get("/account/activate-device/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Register this device", response.content)

        # Submit device name
        response = self.client.post(
            "/account/activate-device/",
            data={"device_name": "Web Device"},
        )
        self.assertEqual(response.status_code, 302)
        self.assertIn("/account/inbox/", response.url)
        device = Device.objects.get(name="Web Device")
        # Transfer cookie
        self.client.cookies[COOKIE_NAME] = response.cookies[COOKIE_NAME].value

        # Verify we're now connected (can access inbox)
        response = self.client.get("/account/inbox/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Inbox", response.content)

        # Disconnect
        response = self.client.get("/disconnect")
        self.assertEqual(response.status_code, 302)
        self.assertFalse(Device.objects.filter(id=device.id).exists())

        # Verify disconnected (redirected to activate-device since session still active)
        response = self.client.get("/account/inbox/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/account/activate-device/", response.url)

    def test_activate_device_rejects_empty_name(self):
        user = User.objects.create_user(username="emptyuser", password="emptypass")
        self._account_login(user)

        response = self.client.post(
            "/account/activate-device/",
            data={"device_name": ""},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Device name is required", response.content)
        self.assertFalse(Device.objects.filter(owner=user).exists())

    def test_activate_device_redirects_when_already_registered(self):
        """Visiting activate-device with existing device redirects to connected devices with message."""
        user, device = self._setup_account_and_device(
            username="alreadyuser", password="alreadypass", device_name="Already Here"
        )

        response = self.client.get("/account/activate-device/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/account/connected-devices/", response.url)

        # Follow the redirect and check for the message
        response = self.client.get("/account/activate-device/", follow=True)
        self.assertContains(response, "already registered")
        self.assertContains(response, "Already Here")

    def test_hop_redirects_to_login_when_logged_out(self):
        response = self.client.get("/hop?type=url&body=https://example.com/story")

        self.assertEqual(response.status_code, 302)
        self.assertIn("/account/login/", response.url)
        self.assertIn("next=", response.url)

    def test_activate_device_redirects_to_pending_next(self):
        user = User.objects.create_user(username="penduser", password="pendpass")
        self._account_login(user)

        response = self.client.post(
            "/account/activate-device/",
            data={
                "device_name": "Bookmarklet Browser",
                "next": "/account/send/?type=url&body=https%3A%2F%2Fexample.com%2Fstory",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "/account/send/?type=url&body=https%3A%2F%2Fexample.com%2Fstory")

    def test_forgetting_browser_deletes_device_record(self):
        _, device_token = create_device_token(name="Forget Me")
        self._connect_device(device_token)
        device = Device.objects.get(name="Forget Me")

        response = self.client.get("/disconnect")

        self.assertEqual(response.status_code, 302)
        self.assertFalse(Device.objects.filter(id=device.id).exists())

    def test_legacy_connect_redirects_to_login(self):
        """The old /connect URL redirects to account login."""
        response = self.client.get("/connect")

        self.assertEqual(response.status_code, 302)
        self.assertIn("/account/login/", response.url)

    def test_inbox_page_includes_push_state_controls(self):
        user, _ = self._setup_account_and_device(device_name="Push UI Device")

        response = self.client.get("/account/inbox/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="push-disable"', response.content)
        self.assertIn(b'refreshPushState', response.content)

    @PATCH_RELAY
    def test_web_send_page_url_flow(self, mock_relay):
        """Test sending URL via web send page."""
        user = User.objects.create_user(username="sender_u", password="pass")
        self._account_login(user)
        _, sender_token = create_device_token(name="Sender", owner=user)
        self._connect_device(sender_token)
        recipient, _ = create_device_token(name="Recipient", owner=user)

        # Access send page
        response = self.client.get("/account/send/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Send", response.content)

        # Send URL message via web form
        response = self.client.post(
            "/account/send/",
            data={
                "type": "url",
                "body": "https://example.com/test",
                "recipient_device_id": str(recipient.id),
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"success", response.content.lower())

    def test_web_send_page_with_prefilled_params(self):
        """Test send page with prefilled URL parameters."""
        user, _ = self._setup_account_and_device(device_name="Test Device")

        # Access send page with prefilled params
        response = self.client.get("/account/send/?type=url&body=https://prefilled.com")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"https://prefilled.com", response.content)

    # ============================================================
    # CONCURRENT OPERATIONS END-TO-END TESTS
    # ============================================================

    @PATCH_RELAY
    def test_multiple_devices_can_send_concurrently(self, mock_relay):
        """Test that multiple devices can send messages simultaneously."""
        # Create 3 devices
        devices = []
        for i in range(3):
            device, token = create_device_token(name=f"Device {i}")
            devices.append({
                "id": str(device.id),
                "token": token,
            })

        # Each device sends a message to the others
        for i, sender in enumerate(devices):
            for j, recipient in enumerate(devices):
                if i != j:  # Don't send to self
                    response = self.client.post(
                        "/api/messages",
                        data=json.dumps({
                            "recipient_device_id": recipient["id"],
                            "type": "text",
                            "body": f"Message from Device {i} to Device {j}",
                        }),
                        content_type="application/json",
                        headers={"Authorization": f"Bearer {sender['token']}"},
                    )
                    self.assertEqual(response.status_code, 201)

    # ============================================================
    # ERROR HANDLING END-TO-END TESTS
    # ============================================================

    @PATCH_RELAY
    def test_invalid_message_types_rejected(self, mock_relay):
        """Test that invalid message types are rejected."""
        sender, sender_token = create_device_token(name="Sender")

        recipient, recipient_token = create_device_token(name="Recipient")
        recipient_id = str(recipient.id)

        # Try to send with invalid type
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": recipient_id,
                "type": "invalid_type",
                "body": "Test message",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )
        self.assertEqual(response.status_code, 400)

    def test_device_creation_with_valid_name(self):
        """Test that devices can be created with valid names."""
        device, token = create_device_token(name="Whitespace-Name")
        self.assertIsNotNone(device)
        self.assertIsNotNone(token)

    # ============================================================
    # ADMIN OPERATIONS END-TO-END TESTS
    # ============================================================

    @PATCH_RELAY
    def test_admin_can_send_test_message_via_action(self, mock_relay):
        """Test that admin can send test message to device via admin action."""
        User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )
        self.client.login(username="admin", password="adminpass123")

        device, _ = create_device_token(name="Test Device")

        # Trigger admin action to send test message
        response = self.client.post(
            "/admin/core/device/",
            data={
                "action": "send_test_message",
                "select_across": "0",
                "_selected_action": str(device.id),
            },
        )
        self.assertIn(response.status_code, [200, 302])

    def test_admin_can_filter_and_search_devices(self):
        """Test admin device list filtering and search."""
        User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )
        self.client.login(username="admin", password="adminpass123")

        for i in range(3):
            create_device_token(name=f"TestDevice{i}")

        # Access admin device list
        response = self.client.get("/admin/core/device/")
        self.assertEqual(response.status_code, 200)

        # Search for specific device
        response = self.client.get("/admin/core/device/?q=TestDevice1")
        self.assertEqual(response.status_code, 200)

    # ============================================================
    # MULTI-USER ISOLATION TESTS
    # ============================================================

    def _make_user(self, username):
        return User.objects.create_user(username=username, password="pass")

    def _account_login(self, user):
        """Log into the account dashboard via the separate account session key."""
        from core.account_auth import SESSION_KEY
        session = self.client.session
        session[SESSION_KEY] = user.pk
        session.save()

    def test_api_devices_only_returns_same_owner_devices(self):
        """Device list API returns only devices belonging to the same owner."""
        user_a = self._make_user("user_a")
        user_b = self._make_user("user_b")
        device_a, token_a = create_device_token(name="A Phone", owner=user_a)
        create_device_token(name="B Phone", owner=user_b)

        response = self.client.get(
            "/api/devices",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        self.assertEqual(response.status_code, 200)
        names = [d["name"] for d in response.json()]
        self.assertIn("A Phone", names)
        self.assertNotIn("B Phone", names)

    @PATCH_RELAY
    def test_api_cannot_send_to_different_owner_device(self, mock_relay):
        """A device cannot send a message to a device owned by a different user."""
        user_a = self._make_user("send_a")
        user_b = self._make_user("send_b")
        _, token_a = create_device_token(name="Sender A", owner=user_a)
        device_b, _ = create_device_token(name="Recipient B", owner=user_b)

        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": str(device_b.id),
                "type": "text",
                "body": "cross-user send attempt",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "recipient_not_found")

    def test_activate_device_assigns_correct_owner(self):
        """Device registered via /account/activate-device/ inherits owner from session."""
        user = self._make_user("activate_owner")
        self._account_login(user)

        response = self.client.post(
            "/account/activate-device/",
            data={"device_name": "New Device"},
        )
        self.assertEqual(response.status_code, 302)

        new_device = Device.objects.get(name="New Device")
        self.assertEqual(new_device.owner, user)

    def test_account_dashboard_only_shows_own_devices(self):
        """Account dashboard connected devices page only lists the logged-in user's devices."""
        user_a = self._make_user("dash_a")
        user_b = self._make_user("dash_b")
        create_device_token(name="Alice Phone", owner=user_a)
        create_device_token(name="Bob Phone", owner=user_b)

        self._account_login(user_a)
        response = self.client.get("/account/connected-devices/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Alice Phone")
        self.assertNotContains(response, "Bob Phone")

    def test_account_remove_device_only_removes_own_device(self):
        """A user cannot remove another user's device via the account dashboard."""
        user_a = self._make_user("rem_a")
        user_b = self._make_user("rem_b")
        _, _ = create_device_token(name="A Device", owner=user_a)
        device_b, _ = create_device_token(name="B Device", owner=user_b)

        self._account_login(user_a)
        response = self.client.post(f"/account/connected-devices/{device_b.id}/remove")
        # Should not remove device_b; it still exists
        self.assertTrue(Device.objects.filter(id=device_b.id).exists())
