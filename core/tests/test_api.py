import json
from unittest.mock import patch

from django.test import TestCase
from django.test import override_settings

from core.models import PushSubscription
from core.services.auth import create_device_token


class ApiFlowTests(TestCase):
    def register_device(self, name: str):
        device, token = create_device_token(name=name)
        return device, token

    def test_register_device_via_pairing_pin(self):
        from core.services.auth import create_pairing_pin

        _, raw_pin = create_pairing_pin()

        response = self.client.post(
            "/api/pairings/pin/register",
            data=json.dumps(
                {
                    "pin": raw_pin,
                    "device_name": "Desktop Firefox",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["device"]["name"], "Desktop Firefox")
        self.assertTrue(payload["token"].startswith("device_"))

    @patch("core.services.push.relay_push_message", return_value={"delivered": 0, "total": 0})
    def test_message_relay_returns_push_status(self, mock_push):
        sender, sender_token = self.register_device("Sender")
        recipient, recipient_token = self.register_device("Recipient")

        response = self.client.post(
            "/api/messages",
            data=json.dumps(
                {
                    "recipient_device_id": str(recipient.id),
                    "type": "url",
                    "body": "https://example.com",
                }
            ),
            content_type="application/json",
            headers={"Authorization": f"Bearer {sender_token}"},
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertIn("id", payload)
        self.assertEqual(payload["type"], "url")
        self.assertEqual(payload["body"], "https://example.com")
        self.assertIn("push_delivered", payload)
        self.assertIn("push_subscriptions", payload)

    def test_invalid_token_cannot_access_authenticated_endpoint(self):
        response = self.client.get(
            "/api/device/me",
            headers={"Authorization": "Bearer invalid-token"},
        )

        self.assertEqual(response.status_code, 401)

    def test_pairing_pin_registers_device(self):
        _, issuer_token = self.register_device("Issuer Device")

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
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(register_response.status_code, 201)
        self.assertEqual(register_response.json()["device"]["name"], "Pinned Device")
        self.assertTrue(register_response.json()["token"].startswith("device_"))

    def test_pairing_pin_is_single_use_over_api(self):
        _, issuer_token = self.register_device("Issuer Again")

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
        from django.contrib.auth import get_user_model
        User = get_user_model()
        owner = User.objects.create_user(username="conflict_owner", password="pass")

        issuer, issuer_token = create_device_token(name="Issuer Conflict", owner=owner)
        create_device_token(name="Existing Device", owner=owner)

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
        _, token = self.register_device("Push Device")

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
