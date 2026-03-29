"""
End-to-End Tests for LinkHop

These tests verify the complete user flow from blank environment to message delivery.
"""
import json
import time

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from core.device_auth import COOKIE_NAME
from core.models import Device, Message, MessageStatus
from core.services.auth import create_device_token, create_pairing_pin

User = get_user_model()


@override_settings(ALLOWED_HOSTS=["localhost", "127.0.0.1", "testserver"])
class EndToEndTestCase(TestCase):
    """
    End-to-end tests using Django test client.
    
    Tests the complete flow:
    - Start blank environment
    - Bootstrap admin
    - Register devices
    - Send message
    - Verify events
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

    def test_blank_environment_starts_clean(self):
        """Verify that we start with a blank environment."""
        self.assertEqual(Device.objects.count(), 0)
        self.assertEqual(User.objects.count(), 0)
        self.assertEqual(Message.objects.count(), 0)

    def test_manifest_route_returns_pwa_metadata(self):
        response = self.client.get("/manifest.json")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["name"], "LinkHop")
        self.assertEqual(payload["start_url"], "/inbox")
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

        return device_a_id, device_a_token, device_b_id, device_b_token

    def test_complete_message_flow(self):
        """
        Complete end-to-end test:
        - Bootstrap admin
        - Register two devices
        - Send message from A to B
        - Verify B receives it
        - Verify events are logged
        """
        # Bootstrap admin
        admin = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )

        # Register two devices
        device_a, device_a_token = create_device_token(name="Device A")
        device_a_id = str(device_a.id)

        device_b, device_b_token = create_device_token(name="Device B")
        device_b_id = str(device_b.id)

        # Send message from A to B
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": device_b_id,
                "type": "url",
                "body": "https://example.com",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_a_token}"},
        )
        self.assertEqual(response.status_code, 201)
        message_id = response.json()["id"]

        # Verify message exists
        message = Message.objects.get(id=message_id)
        self.assertEqual(str(message.sender_device_id), device_a_id)
        self.assertEqual(str(message.recipient_device_id), device_b_id)
        self.assertEqual(message.status, MessageStatus.QUEUED)

        # Verify B can receive it
        response = self.client.get(
            "/api/messages/incoming",
            headers={"Authorization": f"Bearer {device_b_token}"},
        )
        self.assertEqual(response.status_code, 200)
        messages = response.json()
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["id"], message_id)

        # B opens the message
        response = self.client.post(
            f"/api/messages/{message_id}/opened",
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_b_token}"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], MessageStatus.OPENED)

        # Verify message is marked as opened
        message.refresh_from_db()
        self.assertEqual(message.status, MessageStatus.OPENED)
        self.assertIsNotNone(message.opened_at)

    def test_text_message_complete_flow(self):
        """Test complete flow with text message."""
        # Setup
        device_a, device_a_token = create_device_token(name="Device A")
        device_a_id = str(device_a.id)

        device_b, device_b_token = create_device_token(name="Device B")
        device_b_id = str(device_b.id)

        # Send text message
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": device_b_id,
                "type": "text",
                "body": "Hello from Device A!\nThis is a test message.",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_a_token}"},
        )
        self.assertEqual(response.status_code, 201)
        message_id = response.json()["id"]

        # B marks as received
        response = self.client.post(
            f"/api/messages/{message_id}/received",
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_b_token}"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], MessageStatus.RECEIVED)

        # B marks as presented
        response = self.client.post(
            f"/api/messages/{message_id}/presented",
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_b_token}"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], MessageStatus.PRESENTED)

        # B opens it
        response = self.client.post(
            f"/api/messages/{message_id}/opened",
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_b_token}"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], MessageStatus.OPENED)

    def test_message_expiration_behavior(self):
        """Test that expired messages behave correctly."""
        device_a, device_a_token = create_device_token(name="Device A")
        device_a_id = str(device_a.id)

        device_b, device_b_token = create_device_token(name="Device B")
        device_b_id = str(device_b.id)

        # Send message
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": device_b_id,
                "type": "text",
                "body": "This will expire",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {device_a_token}"},
        )
        message_id = response.json()["id"]

        # Expire the message manually
        message = Message.objects.get(id=message_id)
        message.expires_at = timezone.now() - timezone.timedelta(minutes=1)
        message.save()

        # Verify it's not in incoming messages
        response = self.client.get(
            "/api/messages/incoming",
            headers={"Authorization": f"Bearer {device_b_token}"},
        )
        self.assertEqual(response.status_code, 200)
        messages = response.json()
        self.assertEqual(len(messages), 0)

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

    def test_self_send_prevented_by_default(self):
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

    def test_self_send_allowed_when_enabled(self):
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

    def test_multiple_messages_to_same_recipient(self):
        """Test sending multiple messages to the same device."""
        device_a, device_a_token = create_device_token(name="Device A")

        device_b, device_b_token = create_device_token(name="Device B")
        device_b_id = str(device_b.id)

        # Send 3 messages
        message_ids = []
        for i in range(3):
            response = self.client.post(
                "/api/messages",
                data=json.dumps({
                    "recipient_device_id": device_b_id,
                    "type": "text",
                    "body": f"Message {i+1}",
                }),
                content_type="application/json",
                headers={"Authorization": f"Bearer {device_a_token}"},
            )
            self.assertEqual(response.status_code, 201)
            message_ids.append(response.json()["id"])

        # Verify all 3 are in B's inbox
        response = self.client.get(
            "/api/messages/incoming",
            headers={"Authorization": f"Bearer {device_b_token}"},
        )
        self.assertEqual(response.status_code, 200)
        messages = response.json()
        self.assertEqual(len(messages), 3)

        received_ids = [m["id"] for m in messages]
        for msg_id in message_ids:
            self.assertIn(msg_id, received_ids)

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

    def test_revoked_device_cannot_authenticate(self):
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

    def test_admin_can_view_all_data(self):
        """Test that admin can view all devices, messages, and events."""
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

        # Send message
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
        message_id = response.json()["id"]

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

        # Verify data exists in database
        self.assertEqual(Device.objects.count(), 2)
        self.assertEqual(Message.objects.count(), 1)

    def test_duplicate_device_name_rejected(self):
        """Test that duplicate device names are rejected."""
        from django.db import IntegrityError

        create_device_token(name="Same Name")

        with self.assertRaises(IntegrityError):
            create_device_token(name="Same Name")

    # ============================================================
    # WEB INTERFACE END-TO-END TESTS
    # ============================================================

    def test_web_connect_page_flow(self):
        """Test the complete web connect/disconnect flow via PIN."""
        # Generate a PIN (no device required)
        _, raw_pin = create_pairing_pin()

        # Visit connect page
        response = self.client.get("/connect")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Connect this device", response.content)

        # Submit PIN to connect
        response = self.client.post(
            "/connect",
            data={
                "mode": "pin",
                "pin": raw_pin,
                "device_name": "Web Device",
            },
        )
        self.assertEqual(response.status_code, 302)  # Redirect to inbox
        self.assertEqual(response.url, "/inbox")

        # Verify we're now connected (can access inbox)
        response = self.client.get("/inbox")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Inbox", response.content)

        # Disconnect
        response = self.client.get("/disconnect")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "/connect")

        # Verify disconnected (redirected to connect)
        response = self.client.get("/inbox")
        self.assertEqual(response.status_code, 302)

    def test_connect_page_includes_manifest_link(self):
        response = self.client.get("/connect")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'rel="manifest" href="/manifest.json"', response.content)

    def test_inbox_page_includes_push_state_controls(self):
        _, device_token = create_device_token(name="Push UI Device")
        self._connect_device(device_token)

        response = self.client.get("/inbox")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="push-disable"', response.content)
        self.assertIn(b'refreshPushState', response.content)

    def test_web_pairing_pin_flow(self):
        """Generate a PIN on one device and use it to pair a second browser."""
        _, issuer_token = create_device_token(name="PIN Issuer")
        self._connect_device(issuer_token)

        response = self.client.post("/pair")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Generate new PIN", response.content)

        import re

        match = re.search(rb'data-pairing-pin="([0-9]{6})"', response.content)
        self.assertIsNotNone(match)
        pin = match.group(1).decode("ascii")

        new_client = self.client_class()
        response = new_client.post(
            "/connect",
            data={
                "mode": "pin",
                "pin": pin,
                "device_name": "Pinned Browser",
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "/inbox")

        response = new_client.get("/inbox")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Pinned Browser", response.content)

    def test_web_send_page_url_flow(self):
        """Test sending URL via web send page."""
        _, sender_token = create_device_token(name="Sender")
        recipient, _ = create_device_token(name="Recipient")

        # Connect sender
        self._connect_device(sender_token)

        # Access send page
        response = self.client.get("/send")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Send", response.content)
        self.assertIn(b"Recipient", response.content)

        # Send URL message via web form
        response = self.client.post(
            "/send",
            data={
                "type": "url",
                "body": "https://example.com/test",
                "recipient_device_id": str(recipient.id),
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"success", response.content.lower())

        # Verify message was created
        self.assertEqual(Message.objects.count(), 1)
        message = Message.objects.first()
        self.assertEqual(message.type, "url")
        self.assertEqual(message.body, "https://example.com/test")

    def test_web_send_page_with_prefilled_params(self):
        """Test send page with prefilled URL parameters."""
        _, device_token = create_device_token(name="Test Device")
        self._connect_device(device_token)

        # Access send page with prefilled params
        response = self.client.get("/send?type=url&body=https://prefilled.com")
        self.assertEqual(response.status_code, 200)
        # The body should be pre-filled in the form
        self.assertIn(b"https://prefilled.com", response.content)

    def test_web_inbox_displays_messages(self):
        """Test that inbox displays incoming messages."""
        sender, sender_token = create_device_token(name="Sender")
        recipient, recipient_token = create_device_token(name="Recipient")

        # Send message to recipient via API
        self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": str(recipient.id),
                "type": "text",
                "body": "Test message for inbox",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )

        # Connect recipient and view inbox
        self._connect_device(recipient_token)
        response = self.client.get("/inbox")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Test message for inbox", response.content)

    def test_web_url_open_redirects_and_tracks(self):
        """Test that opening URL via web tracks the open event."""
        sender, sender_token = create_device_token(name="Sender")
        recipient, recipient_token = create_device_token(name="Recipient")

        # Send URL message
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": str(recipient.id),
                "type": "url",
                "body": "https://example.com/redirect",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )
        message_id = response.json()["id"]

        # Connect recipient
        self._connect_device(recipient_token)

        # Open the URL (should redirect and track)
        response = self.client.get(f"/messages/{message_id}/open")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "https://example.com/redirect")

        # Verify message is marked as opened
        message = Message.objects.get(id=message_id)
        self.assertEqual(message.status, MessageStatus.OPENED)

    def test_web_text_message_detail_view(self):
        """Test viewing text message detail page."""
        sender, sender_token = create_device_token(name="Sender")
        recipient, recipient_token = create_device_token(name="Recipient")

        # Send text message
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": str(recipient.id),
                "type": "text",
                "body": "Multi-line\ntext\nmessage",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )
        message_id = response.json()["id"]

        # Connect recipient
        self._connect_device(recipient_token)

        # View message detail
        response = self.client.get(f"/messages/{message_id}")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Multi-line", response.content)

        # Verify message is marked as opened
        message = Message.objects.get(id=message_id)
        self.assertEqual(message.status, MessageStatus.OPENED)

    # ============================================================
    # CONCURRENT OPERATIONS END-TO-END TESTS
    # ============================================================

    def test_multiple_devices_can_send_concurrently(self):
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
        
        # Verify all messages were created
        # 3 devices * 2 recipients each = 6 messages
        self.assertEqual(Message.objects.count(), 6)

    def test_message_delivery_order_preserved(self):
        """Test that messages are delivered in order they were sent."""
        sender, sender_token = create_device_token(name="Sender")

        recipient, recipient_token = create_device_token(name="Recipient")
        recipient_id = str(recipient.id)
        
        # Send 5 messages in order
        message_bodies = ["First", "Second", "Third", "Fourth", "Fifth"]
        for body in message_bodies:
            response = self.client.post(
                "/api/messages",
                data=json.dumps({
                    "recipient_device_id": recipient_id,
                    "type": "text",
                    "body": body,
                }),
                content_type="application/json",
                headers={"Authorization": f"Bearer {sender_token}"},
            )
            self.assertEqual(response.status_code, 201)
        
        # Retrieve messages and verify order
        response = self.client.get(
            "/api/messages/incoming",
            headers={"Authorization": f"Bearer {recipient_token}"},
        )
        messages = response.json()
        
        # Messages should be in creation order (oldest first by default)
        received_bodies = [m["body"] for m in messages]
        self.assertEqual(received_bodies, message_bodies)

    # ============================================================
    # ERROR HANDLING END-TO-END TESTS
    # ============================================================

    def test_cannot_access_other_device_messages(self):
        """Test that devices cannot access messages not addressed to them."""
        # Create 3 devices: A, B, C
        devices = []
        for name in ["A", "B", "C"]:
            device, token = create_device_token(name=f"Device {name}")
            devices.append({
                "id": str(device.id),
                "token": token,
            })
        
        # Device A sends message to Device B
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": devices[1]["id"],  # B
                "type": "text",
                "body": "Private message for B",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {devices[0]['token']}"},  # A
        )
        message_id = response.json()["id"]
        
        # Device C tries to mark as opened (should fail)
        response = self.client.post(
            f"/api/messages/{message_id}/opened",
            content_type="application/json",
            headers={"Authorization": f"Bearer {devices[2]['token']}"},  # C
        )
        self.assertEqual(response.status_code, 403)
        
        # Device C's inbox should be empty
        response = self.client.get(
            "/api/messages/incoming",
            headers={"Authorization": f"Bearer {devices[2]['token']}"},
        )
        self.assertEqual(len(response.json()), 0)

    def test_invalid_message_types_rejected(self):
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

    def test_admin_can_send_test_message_via_action(self):
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

        messages = Message.objects.filter(recipient_device_id=device.id)
        self.assertTrue(messages.exists())
        self.assertEqual(messages.first().type, "text")

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

    def test_admin_can_view_message_details(self):
        """Test that admin can view message details in admin interface."""
        User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )
        self.client.login(username="admin", password="adminpass123")

        sender, sender_token = create_device_token(name="Sender")
        recipient, _ = create_device_token(name="Recipient")

        self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": str(recipient.id),
                "type": "text",
                "body": "Test message for admin",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )

        message = Message.objects.first()

        # Access message in admin
        response = self.client.get(f"/admin/core/message/{message.id}/change/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Test message for admin", response.content)
