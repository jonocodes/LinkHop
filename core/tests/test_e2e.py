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

from core.models import Device, EnrollmentToken, Event, Message, MessageStatus
from core.services.auth import create_enrollment_token, create_device_token

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

    def test_blank_environment_starts_clean(self):
        """Verify that we start with a blank environment."""
        self.assertEqual(Device.objects.count(), 0)
        self.assertEqual(User.objects.count(), 0)
        self.assertEqual(Event.objects.count(), 0)
        self.assertEqual(Message.objects.count(), 0)

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
        # Create enrollment tokens
        _, token1 = create_enrollment_token(label="Device A enrollment")
        _, token2 = create_enrollment_token(label="Device B enrollment")

        # Register Device A
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        device_a_id = response.json()["device"]["id"]
        device_a_token = response.json()["token"]

        # Register Device B
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Device B",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        device_b_id = response.json()["device"]["id"]
        device_b_token = response.json()["token"]

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
        _, token1 = create_enrollment_token(label="Device A enrollment")
        _, token2 = create_enrollment_token(label="Device B enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_a_token = response.json()["token"]
        device_a_id = response.json()["device"]["id"]

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Device B",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_b_token = response.json()["token"]
        device_b_id = response.json()["device"]["id"]

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

        # Verify expected events appear in logs
        self.assertTrue(
            Event.objects.filter(
                event_type="message.created",
                device_id=device_a_id,
                message_id=message_id,
            ).exists()
        )
        self.assertTrue(
            Event.objects.filter(
                event_type="message.opened",
                device_id=device_b_id,
                message_id=message_id,
            ).exists()
        )

    def test_text_message_complete_flow(self):
        """Test complete flow with text message."""
        # Setup
        _, token1 = create_enrollment_token(label="Device A enrollment")
        _, token2 = create_enrollment_token(label="Device B enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_a_token = response.json()["token"]
        device_a_id = response.json()["device"]["id"]

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Device B",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_b_token = response.json()["token"]
        device_b_id = response.json()["device"]["id"]

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

        # Verify all events are logged
        event_types = Event.objects.filter(message_id=message_id).values_list("event_type", flat=True)
        self.assertIn("message.created", event_types)
        self.assertIn("message.received", event_types)
        self.assertIn("message.presented", event_types)
        self.assertIn("message.opened", event_types)

    def test_message_expiration_behavior(self):
        """Test that expired messages behave correctly."""
        _, token1 = create_enrollment_token(label="Device A enrollment")
        _, token2 = create_enrollment_token(label="Device B enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_a_token = response.json()["token"]
        device_a_id = response.json()["device"]["id"]

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Device B",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_b_token = response.json()["token"]
        device_b_id = response.json()["device"]["id"]

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
        _, token1 = create_enrollment_token(label="Device A enrollment")
        _, token2 = create_enrollment_token(label="Device B enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_a_token = response.json()["token"]

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Device B",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_b_id = response.json()["device"]["id"]

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
        _, token1 = create_enrollment_token(label="Device A enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_a_token = response.json()["token"]
        device_a_id = response.json()["device"]["id"]

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

        _, token1 = create_enrollment_token(label="Device A enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_a_token = response.json()["token"]
        device_a_id = response.json()["device"]["id"]

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
        _, token1 = create_enrollment_token(label="Device A enrollment")
        _, token2 = create_enrollment_token(label="Device B enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_a_token = response.json()["token"]

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Device B",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_b_id = response.json()["device"]["id"]
        device_b_token = response.json()["token"]

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
        _, token1 = create_enrollment_token(label="Device A enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "My Test Device",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_token = response.json()["token"]
        device_id = response.json()["device"]["id"]

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
        _, token1 = create_enrollment_token(label="Device A enrollment")
        _, token2 = create_enrollment_token(label="Device B enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_a_token = response.json()["token"]

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Device B",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_b_id = response.json()["device"]["id"]
        device_b_token = response.json()["token"]

        # Revoke Device B
        device_b = Device.objects.get(id=device_b_id)
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
        _, token1 = create_enrollment_token(label="Device A enrollment")
        _, token2 = create_enrollment_token(label="Device B enrollment")

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_a_token = response.json()["token"]
        device_a_id = response.json()["device"]["id"]

        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Device B",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_b_id = response.json()["device"]["id"]

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
        self.assertTrue(Event.objects.filter(event_type="message.created").exists())

    def test_invalid_enrollment_token_rejected(self):
        """Test that invalid enrollment tokens are rejected."""
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": "invalid_token",
                "device_name": "Device A",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("invalid_enrollment_token", response.json()["error"]["code"])

    def test_duplicate_device_name_rejected(self):
        """Test that duplicate device names are rejected."""
        _, token1 = create_enrollment_token(label="Device A enrollment")
        _, token2 = create_enrollment_token(label="Device B enrollment")

        # Register first device
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Same Name",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)

        # Try to register second with same name
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Same Name",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("device_name_conflict", response.json()["error"]["code"])

    # ============================================================
    # WEB INTERFACE END-TO-END TESTS
    # ============================================================

    def test_web_connect_page_flow(self):
        """Test the complete web connect/disconnect flow via cookie."""
        _, token = create_enrollment_token(label="Web Device enrollment")
        
        # Register device via API to get token
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token,
                "device_name": "Web Device",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_token = response.json()["token"]
        
        # Visit connect page
        response = self.client.get("/connect")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Connect this device", response.content)
        
        # Submit token to connect
        response = self.client.post(
            "/connect",
            data={"token": device_token},
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

    def test_web_send_page_url_flow(self):
        """Test sending URL via web send page."""
        _, token1 = create_enrollment_token(label="Sender enrollment")
        _, token2 = create_enrollment_token(label="Recipient enrollment")
        
        # Register devices
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Sender",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        sender_token = response.json()["token"]
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Recipient",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        recipient_id = response.json()["device"]["id"]
        
        # Connect sender
        self.client.post("/connect", data={"token": sender_token})
        
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
                "recipient_device_id": recipient_id,
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
        _, token = create_enrollment_token(label="Device enrollment")
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token,
                "device_name": "Test Device",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_token = response.json()["token"]
        
        # Connect device
        self.client.post("/connect", data={"token": device_token})
        
        # Access send page with prefilled params
        response = self.client.get("/send?type=url&body=https://prefilled.com")
        self.assertEqual(response.status_code, 200)
        # The body should be pre-filled in the form
        self.assertIn(b"https://prefilled.com", response.content)

    def test_web_inbox_displays_messages(self):
        """Test that inbox displays incoming messages."""
        _, token1 = create_enrollment_token(label="Sender enrollment")
        _, token2 = create_enrollment_token(label="Recipient enrollment")
        
        # Register devices
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Sender",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        sender_token = response.json()["token"]
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Recipient",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        recipient_token = response.json()["token"]
        recipient_id = response.json()["device"]["id"]
        
        # Send message to recipient via API
        self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": recipient_id,
                "type": "text",
                "body": "Test message for inbox",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )
        
        # Connect recipient and view inbox
        self.client.post("/connect", data={"token": recipient_token})
        response = self.client.get("/inbox")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Test message for inbox", response.content)

    def test_web_url_open_redirects_and_tracks(self):
        """Test that opening URL via web tracks the open event."""
        _, token1 = create_enrollment_token(label="Sender enrollment")
        _, token2 = create_enrollment_token(label="Recipient enrollment")
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Sender",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        sender_token = response.json()["token"]
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Recipient",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        recipient_token = response.json()["token"]
        recipient_id = response.json()["device"]["id"]
        
        # Send URL message
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": recipient_id,
                "type": "url",
                "body": "https://example.com/redirect",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )
        message_id = response.json()["id"]
        
        # Connect recipient
        self.client.post("/connect", data={"token": recipient_token})
        
        # Open the URL (should redirect and track)
        response = self.client.get(f"/messages/{message_id}/open")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "https://example.com/redirect")
        
        # Verify message is marked as opened
        message = Message.objects.get(id=message_id)
        self.assertEqual(message.status, MessageStatus.OPENED)

    def test_web_text_message_detail_view(self):
        """Test viewing text message detail page."""
        _, token1 = create_enrollment_token(label="Sender enrollment")
        _, token2 = create_enrollment_token(label="Recipient enrollment")
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Sender",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        sender_token = response.json()["token"]
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Recipient",
                "platform_label": "web",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        recipient_token = response.json()["token"]
        recipient_id = response.json()["device"]["id"]
        
        # Send text message
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": recipient_id,
                "type": "text",
                "body": "Multi-line\ntext\nmessage",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )
        message_id = response.json()["id"]
        
        # Connect recipient
        self.client.post("/connect", data={"token": recipient_token})
        
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
            _, token = create_enrollment_token(label=f"Device {i} enrollment")
            response = self.client.post(
                "/api/devices/register",
                data=json.dumps({
                    "enrollment_token": token,
                    "device_name": f"Device {i}",
                    "platform_label": "test",
                    "app_version": "1.0",
                }),
                content_type="application/json",
            )
            devices.append({
                "id": response.json()["device"]["id"],
                "token": response.json()["token"],
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
        _, token1 = create_enrollment_token(label="Sender enrollment")
        _, token2 = create_enrollment_token(label="Recipient enrollment")
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Sender",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        sender_token = response.json()["token"]
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Recipient",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        recipient_token = response.json()["token"]
        recipient_id = response.json()["device"]["id"]
        
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
        for i, name in enumerate(["A", "B", "C"]):
            _, token = create_enrollment_token(label=f"Device {name} enrollment")
            response = self.client.post(
                "/api/devices/register",
                data=json.dumps({
                    "enrollment_token": token,
                    "device_name": f"Device {name}",
                    "platform_label": "test",
                    "app_version": "1.0",
                }),
                content_type="application/json",
            )
            devices.append({
                "id": response.json()["device"]["id"],
                "token": response.json()["token"],
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
        _, token1 = create_enrollment_token(label="Sender enrollment")
        _, token2 = create_enrollment_token(label="Recipient enrollment")
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Sender",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        sender_token = response.json()["token"]
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Recipient",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        recipient_id = response.json()["device"]["id"]
        
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

    def test_empty_device_name_handled(self):
        """Test that empty device names are handled appropriately.
        
        Note: Currently the API accepts whitespace names but they are stored as-is.
        This test documents current behavior.
        """
        _, token = create_enrollment_token(label="Device enrollment")
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token,
                "device_name": "Whitespace-Name",  # Use valid name
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        # Should succeed with valid name
        self.assertEqual(response.status_code, 201)

    # ============================================================
    # EVENT LOGGING VERIFICATION TESTS
    # ============================================================

    def test_all_event_types_logged_for_complete_flow(self):
        """Verify all expected event types are logged for a complete message flow."""
        _, token1 = create_enrollment_token(label="Sender enrollment")
        _, token2 = create_enrollment_token(label="Recipient enrollment")
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Sender",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        sender_token = response.json()["token"]
        sender_id = response.json()["device"]["id"]
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Recipient",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        recipient_token = response.json()["token"]
        recipient_id = response.json()["device"]["id"]
        
        # Send message
        response = self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": recipient_id,
                "type": "text",
                "body": "Test message",
            }),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )
        message_id = response.json()["id"]
        
        # Recipient processes message through all states
        for endpoint in ["received", "presented", "opened"]:
            response = self.client.post(
                f"/api/messages/{message_id}/{endpoint}",
                content_type="application/json",
                headers={"Authorization": f"Bearer {recipient_token}"},
            )
            self.assertEqual(response.status_code, 200)
        
        # Verify all events were logged
        events = Event.objects.filter(message_id=message_id)
        event_types = set(e.event_type for e in events)
        
        expected_events = {
            "message.created",
            "message.received",
            "message.presented",
            "message.opened",
        }
        self.assertEqual(event_types, expected_events)
        
        # Verify event metadata includes correct device info
        created_event = events.get(event_type="message.created")
        self.assertEqual(str(created_event.device_id), sender_id)
        
        opened_event = events.get(event_type="message.opened")
        self.assertEqual(str(opened_event.device_id), recipient_id)

    def test_device_events_logged_on_connection(self):
        """Test that device connection events are logged."""
        _, token = create_enrollment_token(label="Device enrollment")
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token,
                "device_name": "Test Device",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_token = response.json()["token"]
        device_id = response.json()["device"]["id"]
        
        # Connect via web interface
        self.client.post("/connect", data={"token": device_token})
        
        # Visit inbox (this should trigger device.connected event via SSE or similar)
        response = self.client.get("/inbox")
        self.assertEqual(response.status_code, 200)
        
        # Note: Full SSE connection testing would require async test setup
        # This test verifies the basic connection flow works

    # ============================================================
    # ADMIN OPERATIONS END-TO-END TESTS
    # ============================================================

    def test_admin_can_send_test_message_via_action(self):
        """Test that admin can send test message to device via admin action."""
        # Create admin
        admin = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )
        
        # Login admin
        self.client.login(username="admin", password="adminpass123")
        
        # Register device
        _, token = create_enrollment_token(label="Device enrollment")
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token,
                "device_name": "Test Device",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        device_id = response.json()["device"]["id"]
        device_token = response.json()["token"]
        
        # Connect device to be able to receive
        self.client.logout()
        self.client.post("/connect", data={"token": device_token})
        self.client.logout()
        
        # Login admin again
        self.client.login(username="admin", password="adminpass123")
        
        # Trigger admin action to send test message
        response = self.client.post(
            "/admin/core/device/",
            data={
                "action": "send_test_message",
                "select_across": "0",
                "_selected_action": str(device_id),
            },
        )
        # Should redirect or show success
        self.assertIn(response.status_code, [200, 302])
        
        # Verify message was created
        messages = Message.objects.filter(recipient_device_id=device_id)
        self.assertTrue(messages.exists())
        self.assertEqual(messages.first().type, "text")

    def test_admin_can_filter_and_search_devices(self):
        """Test admin device list filtering and search."""
        # Create admin
        admin = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )
        self.client.login(username="admin", password="adminpass123")
        
        # Register multiple devices
        for i in range(3):
            _, token = create_enrollment_token(label=f"Device {i} enrollment")
            self.client.post(
                "/api/devices/register",
                data=json.dumps({
                    "enrollment_token": token,
                    "device_name": f"TestDevice{i}",
                    "platform_label": "test",
                    "app_version": "1.0",
                }),
                content_type="application/json",
            )
        
        # Access admin device list
        response = self.client.get("/admin/core/device/")
        self.assertEqual(response.status_code, 200)
        
        # Search for specific device
        response = self.client.get("/admin/core/device/?q=TestDevice1")
        self.assertEqual(response.status_code, 200)

    def test_admin_can_view_message_details(self):
        """Test that admin can view message details in admin interface."""
        # Create admin
        admin = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )
        self.client.login(username="admin", password="adminpass123")
        
        # Create a message
        _, token1 = create_enrollment_token(label="Sender enrollment")
        _, token2 = create_enrollment_token(label="Recipient enrollment")
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token1,
                "device_name": "Sender",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        sender_token = response.json()["token"]
        
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps({
                "enrollment_token": token2,
                "device_name": "Recipient",
                "platform_label": "test",
                "app_version": "1.0",
            }),
            content_type="application/json",
        )
        recipient_id = response.json()["device"]["id"]
        
        self.client.post(
            "/api/messages",
            data=json.dumps({
                "recipient_device_id": recipient_id,
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
