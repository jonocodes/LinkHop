# LinkHop v1 Specification

## Purpose

This document turns the product plan into implementation-ready defaults for v1.

When `PLAN.md` leaves room for interpretation, this file is the source of truth for v1 behavior.

---

## Product Scope

LinkHop v1 is a single-user, self-hosted service for passing ephemeral `url` and `text` messages between a user's own devices.

It is optimized for:

* reliable handoff across temporary offline periods
* simple browser-based use without requiring an extension
* straightforward self-hosting and testability

It is not intended to provide:

* multi-user accounts
* permanent history
* file transfer
* end-to-end encryption

---

## Core Definitions

### Device

A registered client context with its own bearer token.

Examples:

* a desktop browser profile
* a phone browser
* a browser extension later
* a CLI client later

Required device fields:

* `id`
* `name`
* `token_hash`
* `is_active`
* `last_seen_at`
* `created_at`
* `updated_at`

Recommended device metadata:

* `platform_label`
* `app_version`

### Message

An ephemeral item addressed from one device to another.

Required fields:

* `id`
* `sender_device_id` nullable
* `recipient_device_id`
* `type`
* `body`
* `status`
* `created_at`
* `received_at` nullable
* `presented_at` nullable
* `opened_at` nullable
* `expires_at`

Allowed message types:

* `url`
* `text`

Allowed statuses:

* `queued`
* `received`
* `presented`
* `opened`
* `expired`

Status semantics:

* `queued` means accepted by the server and pending recipient acknowledgement
* `received` means the recipient client confirmed it accepted the message
* `presented` means the recipient client surfaced it to the user
* `opened` means the user intentionally interacted with it
* `expired` means the message aged out before completion

Status transitions must be monotonic:

* `queued -> received -> presented -> opened`
* `queued -> expired`
* `received -> expired`
* `presented -> expired`

`opened` is terminal for user-facing purposes, but event creation and log visibility may continue afterward.

### Event

An append-only operational log record for device and message activity.

Required fields:

* `id`
* `event_type`
* `device_id` nullable
* `message_id` nullable
* `created_at`
* `metadata_json`

Expected event types in v1:

* `message.created`
* `message.received`
* `message.presented`
* `message.opened`
* `message.expired`
* `device.connected`
* `device.disconnected`

---

## Validation Rules

### URL messages

For `type=url`:

* `body` must parse as an absolute URL
* allowed schemes are only `http` and `https`
* max length is `2048` characters

### Text messages

For `type=text`:

* `body` is plain text
* newlines are allowed
* empty or whitespace-only bodies are rejected
* max length is `8000` characters

### Shared rules

For all messages:

* `type` must be explicit
* exactly one recipient device is required
* sender device is optional for form posts and required for authenticated API sends

---

## Retention and Expiry

### Message retention

Default message retention window:

* `7 days` from `created_at`

Implementation rule:

* `expires_at = created_at + retention_window`

Expiration behavior:

* expired messages must not appear in normal incoming message results
* expiring a message sets `status=expired` if it was not already `opened`
* expiration creates a `message.expired` event

### Event retention

Default event retention window:

* no automatic pruning in v1

Rationale:

* messages are ephemeral
* operational history is still useful during early development and debugging

---

## Authentication

### Admin

Admin access uses Django admin auth with `django-axes` throttling.

### Device tokens

Device API and SSE auth use bearer tokens.

Token rules:

* mint a token once at registration time
* store only a hash server-side
* show the raw token only at creation time
* reject revoked or inactive devices immediately

Authorization header:

```text
Authorization: Bearer <device-token>
```

---

## Enrollment

v1 enrollment should support:

* bootstrap admin setup in a blank environment
* admin-created or API-created enrollment tokens
* device self-registration using a valid enrollment token

Recommended enrollment token properties:

* random, single-purpose secret
* optionally single-use
* short lifetime, default `24 hours`

Future pairing URL / QR onboarding should follow the same model:

* pairing URLs are one-time bootstrap secrets, not long-lived credentials
* the QR code should encode the temporary pairing URL, never the long-lived device token
* successful pairing always mints a unique per-device bearer token

---

## API Contract

All API responses are JSON.

Error format should be consistent:

```json
{
  "error": {
    "code": "validation_error",
    "message": "body must be a valid absolute http or https URL"
  }
}
```

### `POST /api/devices/register`

Purpose:

* exchange an enrollment token for a device token

Request:

```json
{
  "enrollment_token": "secret-value",
  "device_name": "Desktop Firefox"
}
```

Response:

```json
{
  "device": {
    "id": "uuid",
    "name": "Desktop Firefox",
    "is_active": true
  },
  "token": "raw-device-token"
}
```

### `GET /api/device/me`

Purpose:

* identify the current authenticated device

Response:

```json
{
  "id": "uuid",
  "name": "Desktop Firefox",
  "is_active": true,
  "last_seen_at": "2026-03-25T12:00:00Z"
}
```

### `GET /api/devices`

Purpose:

* list active devices as possible send targets

Response fields per device:

* `id`
* `name`
* `is_online`
* `last_seen_at`

### `POST /api/messages`

Purpose:

* create a message addressed to another device

Request:

```json
{
  "recipient_device_id": "uuid",
  "type": "url",
  "body": "https://example.com"
}
```

Response:

```json
{
  "id": "uuid",
  "status": "queued",
  "recipient_device_id": "uuid",
  "type": "url",
  "body": "https://example.com",
  "created_at": "2026-03-25T12:00:00Z",
  "expires_at": "2026-04-01T12:00:00Z"
}
```

### `GET /api/messages/incoming`

Purpose:

* list non-expired incoming messages for the authenticated device

Default ordering:

* oldest first among unexpired messages

Returned fields:

* `id`
* `sender_device_id`
* `type`
* `body`
* `status`
* `created_at`
* `received_at`
* `presented_at`
* `opened_at`

### `POST /api/messages/{id}/received`

### `POST /api/messages/{id}/presented`

### `POST /api/messages/{id}/opened`

Purpose:

* advance confirmation state for a message belonging to the authenticated recipient device

Rules:

* endpoints are idempotent
* repeating the same confirmation returns success without duplicating side effects
* later confirmations may imply earlier timestamps if missing

Implication rules:

* `presented` may set `received_at` if it was missing
* `opened` may set `received_at` and `presented_at` if they were missing

Response:

```json
{
  "id": "uuid",
  "status": "opened",
  "received_at": "2026-03-25T12:01:00Z",
  "presented_at": "2026-03-25T12:01:05Z",
  "opened_at": "2026-03-25T12:01:06Z"
}
```

---

## Web Routes

### `GET /send`

Supports optional query params:

* `type`
* `body`

Behavior:

* render send form
* prefill values when provided
* require recipient selection before submit

### `POST /send`

Behavior:

* validate input
* create message
* show success UI rather than raw JSON

### `GET /hop`

Behavior:

* alias to the send flow

### `GET /messages/{id}/open`

Behavior for `url` messages:

* verify recipient access
* record `opened`
* redirect to the destination URL

### `GET /messages/{id}`

Behavior for `text` messages:

* verify recipient access
* record `opened`
* render text with preserved newlines

---

## Realtime and Online State

### SSE endpoint

Recommended route:

* `GET /api/events/stream`

Authentication:

* bearer token

Stream events:

* `hello`
* `message`
* `ping`

`message` event payload:

```json
{
  "message_id": "uuid"
}
```

### Reconnect behavior

Clients should:

* reconnect automatically
* use exponential backoff capped at `30 seconds`
* call `GET /api/messages/incoming` after reconnect
* dedupe by `message_id`

### Online state heuristic

`is_online` should be treated as a hint, not a guarantee.

Recommended v1 rule:

* a device is considered online if it has an authenticated active SSE connection

---

## Rate Limits and Operational Defaults

Recommended initial global defaults:

* message sends: `30/minute`
* confirmation endpoints: `120/minute` per device
* device registration: `10/hour`
* max active SSE streams per device: `5`
* max pending unexpired messages per recipient device: `500`

These should be adjustable later through admin-managed settings.

---

## Testing Targets

Implementation is not complete until the following are automatable:

* bootstrap a blank environment
* register two devices
* send `url` and `text` messages
* receive SSE notification for a queued message
* confirm `received`, `presented`, and `opened`
* verify unauthorized device access is rejected
* verify expired messages stop appearing in incoming results

---

## Out of Scope for v1

The following should not block implementation:

* browser extension support
* mobile native app support
* per-device custom policy settings
* automatic duplicate-notification elimination across every client type
* advanced archival, search, or backup features
