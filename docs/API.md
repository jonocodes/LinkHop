# LinkHop API Guide

Complete guide to using the LinkHop REST API.

## Base URL

```
https://your-linkhop-instance.com/api
```

## Authentication

All API endpoints (except device registration) require authentication via Bearer token:

```bash
Authorization: Bearer YOUR_DEVICE_TOKEN
```

The device token is received when registering a device via `/api/devices/register`.

## Endpoints

### Device Registration

Register a new device to obtain an authentication token.

**Endpoint:** `POST /api/devices/register`

**Authentication:** None (requires enrollment token)

**Request Body:**
```json
{
  "enrollment_token": "enroll_abc123...",
  "device_name": "My iPhone",
  "platform_label": "iOS",
  "app_version": "1.0.0"
}
```

**Parameters:**
- `enrollment_token` (required): Token obtained from admin panel
- `device_name` (required): Display name for the device (must be unique)
- `platform_label` (optional): Platform identifier (e.g., "iOS", "Android", "Web")
- `app_version` (optional): Application version string

**Response (201 Created):**
```json
{
  "device": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My iPhone",
    "is_active": true,
    "last_seen_at": null
  },
  "token": "device_xyz789..."
}
```

**⚠️ Important:** Save the `token` value - it's only shown once and cannot be retrieved later!

**Error Responses:**
- `400 Bad Request`: Invalid enrollment token or device name conflict
- `429 Too Many Requests`: Rate limit exceeded (too many registrations from this IP)

---

### List Devices

Get a list of all active devices that can receive messages.

**Endpoint:** `GET /api/devices`

**Authentication:** Bearer token required

**Response (200 OK):**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My iPhone",
    "is_active": true,
    "is_online": true,
    "last_seen_at": "2026-03-26T12:00:00Z"
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "My Laptop",
    "is_active": true,
    "is_online": false,
    "last_seen_at": "2026-03-26T10:30:00Z"
  }
]
```

---

### Get Current Device

Get information about the authenticated device.

**Endpoint:** `GET /api/device/me`

**Authentication:** Bearer token required

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My iPhone",
  "is_active": true,
  "last_seen_at": "2026-03-26T12:00:00Z"
}
```

---

### Push Configuration

Get push capability for the authenticated device and the public VAPID key needed
for subscription from an installed PWA.

**Endpoint:** `GET /api/push/config`

**Authentication:** Bearer token required

**Response (200 OK):**
```json
{
  "supported": true,
  "vapid_public_key": "BExamplePublicKey"
}
```

**Notes:**
- `supported` is `false` when Web Push is not configured server-side
- when `supported` is `false`, `vapid_public_key` is empty

---

### Save Push Subscription

Store or update the browser push subscription for the authenticated device.

**Endpoint:** `POST /api/push/subscriptions`

**Authentication:** Bearer token required

**Request Body:**
```json
{
  "endpoint": "https://push.example.test/sub/123",
  "keys": {
    "p256dh": "base64url-p256dh",
    "auth": "base64url-auth"
  }
}
```

**Response (204 No Content)**

---

### Remove Push Subscription

Deactivate the stored browser push subscription for the authenticated device.

**Endpoint:** `DELETE /api/push/subscriptions`

**Authentication:** Bearer token required

**Request Body:**
```json
{
  "endpoint": "https://push.example.test/sub/123"
}
```

**Response (204 No Content)**

---

### Send Message

Send a URL or text message to another device.

**Endpoint:** `POST /api/messages`

**Authentication:** Bearer token required

**Request Body:**
```json
{
  "recipient_device_id": "550e8400-e29b-41d4-a716-446655440001",
  "type": "url",
  "body": "https://example.com/article"
}
```

**Parameters:**
- `recipient_device_id` (required): UUID of the target device
- `type` (required): Message type - `"url"` or `"text"`
- `body` (required): Message content
  - For URLs: Must be valid http/https URL, max 2048 characters
  - For text: Max 8000 characters

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "sender_device_id": "550e8400-e29b-41d4-a716-446655440000",
  "recipient_device_id": "550e8400-e29b-41d4-a716-446655440001",
  "type": "url",
  "body": "https://example.com/article",
  "status": "queued",
  "created_at": "2026-03-26T12:00:00Z",
  "expires_at": "2026-04-02T12:00:00Z",
  "received_at": null,
  "presented_at": null,
  "opened_at": null
}
```

**Error Responses:**
- `400 Bad Request`: Invalid recipient, URL validation failed, or self-send not allowed
- `429 Too Many Requests`: Rate limit exceeded (sends per minute)

---

### List Incoming Messages

Get messages queued for the authenticated device.

**Endpoint:** `GET /api/messages/incoming`

**Authentication:** Bearer token required

**Response (200 OK):**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "sender_device_id": "550e8400-e29b-41d4-a716-446655440000",
    "recipient_device_id": "550e8400-e29b-41d4-a716-446655440001",
    "type": "url",
    "body": "https://example.com/article",
    "status": "queued",
    "created_at": "2026-03-26T12:00:00Z",
    "expires_at": "2026-04-02T12:00:00Z"
  }
]
```

**Note:** Opened messages are automatically filtered out from this list.

---

### Mark Message as Received

Mark a message as received by the device (e.g., downloaded to local inbox).

**Endpoint:** `POST /api/messages/{message_id}/received`

**Authentication:** Bearer token required

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "status": "received",
  "received_at": "2026-03-26T12:01:00Z"
}
```

**Error Responses:**
- `400 Bad Request`: Message not found or already processed
- `403 Forbidden`: Message not addressed to this device
- `429 Too Many Requests`: Rate limit exceeded

---

### Mark Message as Presented

Mark a message as presented to the user (e.g., notification shown).

**Endpoint:** `POST /api/messages/{message_id}/presented`

**Authentication:** Bearer token required

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "status": "presented",
  "presented_at": "2026-03-26T12:02:00Z"
}
```

---

### Mark Message as Opened

Mark a message as opened/clicked by the user.

**Endpoint:** `POST /api/messages/{message_id}/opened`

**Authentication:** Bearer token required

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "status": "opened",
  "opened_at": "2026-03-26T12:03:00Z"
}
```

**Note:** For URL messages, you can also use the web interface:
```
GET /messages/{message_id}/open
```
This will track the open and redirect to the URL.

---

## SSE Event Stream

Receive real-time message notifications via Server-Sent Events.

**Endpoint:** `GET /api/events/stream`

**Authentication:** Bearer token required (in `Authorization` header)

**Headers:**
```
Authorization: Bearer YOUR_DEVICE_TOKEN
Accept: text/event-stream
Cache-Control: no-cache
```

**Event Types:**

### `hello`
Sent when connection is established:
```
event: hello
data: {"device_id": "550e8400-e29b-41d4-a716-446655440000"}
```

### `message`
Sent when a new message arrives:
```
event: message
data: {"id": "550e8400-e29b-41d4-a716-446655440002", "type": "url", "body": "https://example.com"}
```

### `ping`
Keepalive sent every 30 seconds:
```
event: ping
data: {}
```

### Example with curl:
```bash
curl -N \
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \
  -H "Accept: text/event-stream" \
  https://your-linkhop-instance.com/api/events/stream
```

### Example with JavaScript:
```javascript
const eventSource = new EventSource('/api/events/stream', {
  headers: {
    'Authorization': 'Bearer YOUR_DEVICE_TOKEN'
  }
});

eventSource.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  console.log('New message:', message);
});

eventSource.addEventListener('hello', (event) => {
  console.log('Connected:', JSON.parse(event.data));
});
```

---

## Complete Workflow Examples

### Example 1: Send a URL from Phone to Laptop

```bash
# 1. Get device list from phone
curl -H "Authorization: Bearer PHONE_TOKEN" \
  https://linkhop.example.com/api/devices

# Response shows laptop with ID: 550e8400-e29b-41d4-a716-446655440001

# 2. Send URL to laptop
curl -X POST \
  -H "Authorization: Bearer PHONE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient_device_id": "550e8400-e29b-41d4-a716-446655440001",
    "type": "url",
    "body": "https://example.com/article"
  }' \
  https://linkhop.example.com/api/messages
```

### Example 2: CLI Script to Send Text

```bash
#!/bin/bash
# send-text.sh - Send text message to default device

DEVICE_TOKEN="${LINKHOP_TOKEN:-}"
RECIPIENT_ID="${LINKHOP_DEFAULT_RECIPIENT:-}"
TEXT="$1"

if [ -z "$TEXT" ]; then
  echo "Usage: $0 'message text'"
  exit 1
fi

curl -X POST \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"recipient_device_id\": \"$RECIPIENT_ID\",
    \"type\": \"text\",
    \"body\": \"$TEXT\"
  }" \
  https://linkhop.example.com/api/messages

echo "Message sent!"
```

### Example 3: Python Client

```python
import requests

class LinkHopClient:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
    
    def list_devices(self):
        """Get list of available devices."""
        response = requests.get(
            f"{self.base_url}/api/devices",
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()
    
    def send_url(self, recipient_id, url):
        """Send a URL to a device."""
        response = requests.post(
            f"{self.base_url}/api/messages",
            headers=self.headers,
            json={
                "recipient_device_id": recipient_id,
                "type": "url",
                "body": url
            }
        )
        response.raise_for_status()
        return response.json()
    
    def send_text(self, recipient_id, text):
        """Send text to a device."""
        response = requests.post(
            f"{self.base_url}/api/messages",
            headers=self.headers,
            json={
                "recipient_device_id": recipient_id,
                "type": "text",
                "body": text
            }
        )
        response.raise_for_status()
        return response.json()
    
    def get_inbox(self):
        """Get incoming messages."""
        response = requests.get(
            f"{self.base_url}/api/messages/incoming",
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()

# Usage
client = LinkHopClient("https://linkhop.example.com", "your-device-token")

# Send URL
client.send_url("recipient-uuid", "https://example.com")

# Send text
client.send_text("recipient-uuid", "Hello from Python!")

# Check inbox
messages = client.get_inbox()
for msg in messages:
    print(f"[{msg['type']}] {msg['body']}")
```

### Example 4: iOS Shortcut (HTTP Shortcuts)

See [HTTP_SHORTCUTS.md](HTTP_SHORTCUTS.md) for detailed setup instructions.

Basic shortcut configuration:

1. **URL:** `https://linkhop.example.com/api/messages`
2. **Method:** POST
3. **Headers:**
   - `Authorization: Bearer YOUR_DEVICE_TOKEN`
   - `Content-Type: application/json`
4. **Body:**
   ```json
   {
     "recipient_device_id": "TARGET_DEVICE_UUID",
     "type": "url",
     "body": "{{URL}}"
   }
   ```

---

## Rate Limits

Default rate limits (configurable in admin):

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /api/messages` | 30 requests | per minute per device |
| `POST /api/messages/{id}/received` | 120 requests | per minute per device |
| `POST /api/messages/{id}/presented` | 120 requests | per minute per device |
| `POST /api/messages/{id}/opened` | 120 requests | per minute per device |
| `POST /api/devices/register` | 10 requests | per hour per IP |

**Response when rate limited (429):**
```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Too many requests. Please try again later."
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "error_code",
    "message": "Human-readable description"
  }
}
```

### Common Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `invalid_token` | 401 | Authentication token invalid or expired |
| `recipient_not_found` | 400 | Recipient device not found or inactive |
| `validation_error` | 400 | Request validation failed |
| `rate_limit_exceeded` | 429 | Too many requests |
| `invalid_enrollment_token` | 400 | Enrollment token invalid or used |
| `device_name_conflict` | 400 | Device name already exists |

---

## Message Lifecycle

```
queued → received → presented → opened
```

1. **queued**: Message created and waiting for recipient
2. **received**: Recipient fetched message to local storage
3. **presented**: Message shown to user (notification/displayed)
4. **opened**: User clicked/opened the message

All states are tracked and viewable in the admin panel.

---

## Tips & Best Practices

1. **Save your device token securely** - It cannot be retrieved if lost
2. **Use environment variables** for tokens in scripts
3. **Handle rate limits gracefully** - Add exponential backoff
4. **Check device online status** before sending time-sensitive messages
5. **Always confirm recipients** - UUIDs are hard to remember, cache device lists
6. **Use the web interface** for one-off sends instead of building CLI tools
7. **Monitor the event stream** for real-time delivery instead of polling

---

## See Also

- [DEPLOYMENT.md](DEPLOYMENT.md) - Deployment instructions
- [ENVIRONMENT.md](ENVIRONMENT.md) - Environment variables
- [HTTP_SHORTCUTS.md](HTTP_SHORTCUTS.md) - Mobile integration guide
