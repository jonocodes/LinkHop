import json
from unittest.mock import patch

from django.test import TestCase
from django.test import override_settings

from core.models import Event, MessageStatus, PushSubscription
from core.services.auth import create_enrollment_token


class ApiFlowTests(TestCase):
    def register_device(self, name: str):
        _, enrollment_token = create_enrollment_token(label=f"{name} token")
        response = self.client.post(
            "/api/devices/register",
            data=json.dumps(
                {
                    "enrollment_token": enrollment_token,
                    "device_name": name,
                    "platform_label": "test",
                    "app_version": "1.0",
                }
            ),
            content_type="application/json",
        )
        return response

    def test_register_device_returns_bearer_token(self):
        response = self.register_device("Desktop Firefox")

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["device"]["name"], "Desktop Firefox")
        self.assertTrue(payload["token"].startswith("device_"))

    def test_message_flow_creates_events_and_allows_confirmation(self):
        sender_response = self.register_device("Sender")
        recipient_response = self.register_device("Recipient")

        sender_token = sender_response.json()["token"]
        recipient = recipient_response.json()["device"]
        recipient_token = recipient_response.json()["token"]

        create_response = self.client.post(
            "/api/messages",
            data=json.dumps(
                {
                    "recipient_device_id": recipient["id"],
                    "type": "url",
                    "body": "https://example.com",
                }
            ),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )

        self.assertEqual(create_response.status_code, 201)
        created_message = create_response.json()
        self.assertEqual(created_message["status"], MessageStatus.QUEUED)

        incoming_response = self.client.get(
            "/api/messages/incoming",
            headers={"Authorization": f"Bearer {recipient_token}"},
        )
        self.assertEqual(incoming_response.status_code, 200)
        incoming_messages = incoming_response.json()
        self.assertEqual(len(incoming_messages), 1)
        self.assertEqual(incoming_messages[0]["id"], created_message["id"])

        received_response = self.client.post(
            f"/api/messages/{created_message['id']}/received",
            content_type="application/json",
            headers={"Authorization": f"Bearer {recipient_token}"},
        )
        self.assertEqual(received_response.status_code, 200)
        self.assertEqual(received_response.json()["status"], MessageStatus.RECEIVED)

        opened_response = self.client.post(
            f"/api/messages/{created_message['id']}/opened",
            content_type="application/json",
            headers={"Authorization": f"Bearer {recipient_token}"},
        )
        self.assertEqual(opened_response.status_code, 200)
        self.assertEqual(opened_response.json()["status"], MessageStatus.OPENED)

        self.assertEqual(Event.objects.filter(event_type="message.created").count(), 1)
        self.assertEqual(Event.objects.filter(event_type="message.received").count(), 1)
        self.assertEqual(Event.objects.filter(event_type="message.opened").count(), 1)

    def test_device_cannot_open_other_devices_message(self):
        sender_response = self.register_device("Sender Device")
        recipient_response = self.register_device("Recipient Device")
        intruder_response = self.register_device("Intruder Device")

        sender_token = sender_response.json()["token"]
        recipient_id = recipient_response.json()["device"]["id"]
        intruder_token = intruder_response.json()["token"]

        create_response = self.client.post(
            "/api/messages",
            data=json.dumps(
                {
                    "recipient_device_id": recipient_id,
                    "type": "text",
                    "body": "hello",
                }
            ),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )

        message_id = create_response.json()["id"]

        forbidden_response = self.client.post(
            f"/api/messages/{message_id}/opened",
            content_type="application/json",
            headers={"Authorization": f"Bearer {intruder_token}"},
        )

        self.assertEqual(forbidden_response.status_code, 403)
        self.assertEqual(forbidden_response.json()["error"]["code"], "forbidden")

    def test_invalid_token_cannot_access_authenticated_endpoint(self):
        response = self.client.get(
            "/api/device/me",
            headers={"Authorization": "Bearer invalid-token"},
        )

        self.assertEqual(response.status_code, 401)

    def test_pairing_pin_registers_device(self):
        issuer_response = self.register_device("Issuer Device")
        issuer_token = issuer_response.json()["token"]

        pin_response = self.client.post(
            "/api/pairings/pin",
            content_type="application/json",
            headers={"Authorization": f"Bearer {issuer_token}"},
        )
        self.assertEqual(pin_response.status_code, 200)
        pin = pin_response.json()["pin"]
        self.assertEqual(len(pin), 6)

        register_response = self.client.post(
            "/api/pairings/pin/register",
            data=json.dumps(
                {
                    "pin": pin,
                    "device_name": "Pinned Device",
                    "platform_label": "android",
                    "app_version": "1.0",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(register_response.status_code, 201)
        self.assertEqual(register_response.json()["device"]["name"], "Pinned Device")
        self.assertTrue(register_response.json()["token"].startswith("device_"))

    def test_pairing_pin_is_single_use_over_api(self):
        issuer_response = self.register_device("Issuer Again")
        issuer_token = issuer_response.json()["token"]

        pin_response = self.client.post(
            "/api/pairings/pin",
            content_type="application/json",
            headers={"Authorization": f"Bearer {issuer_token}"},
        )
        pin = pin_response.json()["pin"]

        first_response = self.client.post(
            "/api/pairings/pin/register",
            data=json.dumps(
                {
                    "pin": pin,
                    "device_name": "PIN First",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(first_response.status_code, 201)

        second_response = self.client.post(
            "/api/pairings/pin/register",
            data=json.dumps(
                {
                    "pin": pin,
                    "device_name": "PIN Second",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(second_response.status_code, 400)
        self.assertEqual(second_response.json()["error"]["code"], "invalid_pairing_pin")

    def test_pairing_pin_survives_device_name_conflict(self):
        issuer_response = self.register_device("Issuer Conflict")
        issuer_token = issuer_response.json()["token"]
        self.register_device("Existing Device")

        pin_response = self.client.post(
            "/api/pairings/pin",
            content_type="application/json",
            headers={"Authorization": f"Bearer {issuer_token}"},
        )
        pin = pin_response.json()["pin"]

        conflict_response = self.client.post(
            "/api/pairings/pin/register",
            data=json.dumps(
                {
                    "pin": pin,
                    "device_name": "Existing Device",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(conflict_response.status_code, 400)
        self.assertEqual(conflict_response.json()["error"]["code"], "device_name_conflict")

        success_response = self.client.post(
            "/api/pairings/pin/register",
            data=json.dumps(
                {
                    "pin": pin,
                    "device_name": "Fresh Device",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(success_response.status_code, 201)

    @override_settings(
        LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY="public-key",
        LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY="private-key",
    )
    def test_push_config_and_subscription_flow(self):
        response = self.register_device("Push Device")
        token = response.json()["token"]

        with patch("core.services.push.webpush", object()):
            config_response = self.client.get(
                "/api/push/config",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(config_response.status_code, 200)
            self.assertTrue(config_response.json()["supported"])
            self.assertEqual(config_response.json()["vapid_public_key"], "public-key")

            create_response = self.client.post(
                "/api/push/subscriptions",
                data=json.dumps(
                    {
                        "endpoint": "https://push.example.test/sub/123",
                        "keys": {
                            "p256dh": "p256dh-key",
                            "auth": "auth-secret",
                        },
                    }
                ),
                content_type="application/json",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(create_response.status_code, 204)
            self.assertEqual(PushSubscription.objects.count(), 1)
            self.assertTrue(PushSubscription.objects.first().is_active)

            delete_response = self.client.delete(
                "/api/push/subscriptions",
                data=json.dumps({"endpoint": "https://push.example.test/sub/123"}),
                content_type="application/json",
                headers={"Authorization": f"Bearer {token}"},
            )
            self.assertEqual(delete_response.status_code, 204)
            self.assertFalse(PushSubscription.objects.get().is_active)
