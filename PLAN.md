# LinkHop Plan

## Overview

LinkHop is a lightweight, self-hosted service for passing ephemeral messages between a user's own devices.

Its primary purpose is reliable handoff, not storage or sync.

Core characteristics:

* Single-user
* Self-hosted
* Ephemeral, queue-backed delivery
* Works without browser extensions
* Supports URL and plain text messages
* Device-to-device sending
* Queue-based correctness with realtime hints

---

## Product Goals

### Primary goal

Make it easy to send a URL or text message from one device to another, even when the recipient device is offline at send time.

### Secondary goals

* Make sending possible from normal browsers, mobile, and later a CLI
* Keep the system easy to test in automation
* Provide operational visibility through an admin/log view
* Keep the architecture simple and easy to self-host

### Non-goals for v1

* Multi-user support
* Long-term message history/archive
* File transfer
* End-to-end encryption
* Rich permissions per device
* Auto-quarantine or auto-removal of devices

---

## Core Concepts

### Device

An addressable browser or app context that can send and receive messages.

Notes:

* In practice there will usually be one active device per device/browser context
* Devices authenticate with per-device tokens
* No per-device policy settings in v1
* Global settings apply to all devices

### Message

A piece of ephemeral content sent from one device to another.

Supported message types in v1:

* `url`
* `text`

Message payload field:

* `body`

### Event

A recorded fact about message or device activity, mainly for debugging and admin visibility.

---

## Core Product Behavior

### Sending

A user can send a message from:

* the normal web app
* Android via HTTP Shortcuts opening the send page
* later, a browser extension
* later, a CLI

### Receiving

A receiving device should:

* get notified when online
* retain queued messages if offline at send time
* surface a user-visible alert or inbox item
* allow the user to click/open the message

### Delivery model

LinkHop uses:

* persistent server-side queue for correctness
* SSE for realtime nudges
* HTTP APIs for state transitions and source of truth

This is a queue-based system with realtime hints, not a purely realtime-only system.
The handoff should be reliable across temporary offline periods, while still treating messages as ephemeral rather than permanent history.

---

## Message Semantics

### Explicit message type

The sender must explicitly set message type.

Allowed values:

* `url`
* `text`

### Body rules

* `url` messages: `body` must be an absolute `http` or `https` URL
* `text` messages: `body` is plain text and may contain newlines

### Ephemeral nature

Messages are intended to be transient.
The service should retain them long enough to support reliable handoff, but devices are not expected to provide long-term searchable history.

Admin/log visibility may retain operational records longer than end-user inboxes.

---

## User Flows

## 1. Web send flow

### Prefilled send page

Open:

* `/send?type=url&body=...`
* `/send?type=text&body=...`

Behavior:

* prefill form
* require recipient device selection
* submit via form or API-backed form flow

### Form submission

`POST /send`

Fields:

* `type`
* `body`
* `recipient_device_id`

Use cases:

* normal browser use
* richer multiline text
* extensionless sending

---

## 2. Programmatic/API send flow

`POST /api/messages`

Request body:

* `recipient_device_id`
* `type`
* `body`

Authentication:

* device bearer token

Use cases:

* automated tests
* future CLI
* future browser extension
* custom integrations

---

## 3. Android mobile flow

Primary approach:

* HTTP Shortcuts opens LinkHop send page with prefilled content

Examples:

* `/hop?type=url&body=...`
* `/hop?type=text&body=...`

Behavior:

* content is prefilled
* user selects recipient device dynamically in the web UI
* user submits from the app page

Rationale:

* no native app required
* no special mobile handling
* works with dynamic device selection
* supports URL and text

---

## 4. Receive flow

When a device is online:

* device maintains an SSE connection
* server emits message events
* client fetches or accepts the message
* client shows notification and/or inbox item

When a device is offline:

* message remains queued
* delivery is attempted again when the device reconnects

---

## Confirmation Signals

### Goal

Track meaningful delivery and user interaction without auto-opening URLs.

### Signals

#### `received`

The client has accepted the message and can show it later.

#### `presented`

The message was surfaced in a user-visible way.
Examples:

* browser notification shown
* inbox item rendered in active UI

#### `opened`

The user intentionally interacted with the message.
Examples:

* clicked a notification
* clicked a message row

---

## Notes on Terminology

To keep the docs consistent:

* "reliable handoff" means messages are queued server-side until received, rather than being dropped just because the target device was offline
* "ephemeral" means LinkHop is not meant to be a long-term archive or sync system
* realtime delivery is an optimization layered on top of the queue, not the source of truth

### URL open tracking

For URL messages, user interaction should go through an app route first:

* `GET /messages/{id}/open`
* record `opened`
* redirect to destination URL

### Text open tracking

For text messages:

* `GET /messages/{id}`
* record `opened`
* render text message detail

### Notes

* Notification display does not equal opened
* In v1, opening a text message detail can also count as reading it

---

## Message Lifecycle

Recommended lifecycle timestamps:

* `created_at`
* `received_at`
* `presented_at`
* `opened_at`

Recommended statuses:

* `queued`
* `received`
* `presented`
* `opened`
* `failed`

Operationally, events should provide more detail than statuses.

---

## Device and Notification Behavior

### Web app first

The system must work fully without extensions.

### Extension support later

If an extension exists in the same browser context:

* the extension is the primary handler
* the web app is secondary/fallback for notifications and active handling
* duplicate notifications should be avoided

### No auto-open requirement

LinkHop does not need to auto-open URLs.
The core value is surfacing actionable messages the user can click.

---

## Realtime Design

### Transport

Use Server-Sent Events (SSE) for realtime notification.

Why:

* one-way server-to-client fits the use case
* HTTP remains the source of truth for client actions
* simpler than WebSockets for v1

### SSE events

Initial stream events:

* `hello`
* `message`
* `ping`

### Reconnect behavior

* clients reconnect automatically
* on reconnect, clients re-sync pending messages via HTTP
* clients dedupe messages by message ID

---

## Authentication and Enrollment

### Admin auth

* Django admin for operational management
* django-axes for admin login throttling
* no email registration required

### Device auth

* each device gets a long-lived bearer token
* device tokens are revocable
* device tokens authenticate API calls and SSE

### Enrollment

Use API/admin-controlled enrollment rather than email.

Requirements:

* blank environment should be easy to bootstrap
* automated tests should be able to create/register devices programmatically

Recommended support:

* bootstrap admin secret for fresh environment
* enrollment token flow for normal device registration
* optional test-only seed endpoints in test mode

---

## Security and Throttling

### Principles

* keep controls global, not per-device configurable
* make thresholds adjustable in admin
* avoid automatic quarantine/removal behavior in v1

### Recommended globally configurable limits

* admin login attempts/window
* message sends per minute
* receipt/open events per minute
* max active SSE streams per device
* max pending messages per device
* max URL length
* max text body size

### Compromise containment

If a device token is compromised:

* revoke the token/device from admin
* rely on global rate limits to limit abuse
* use logs for investigation

---

## Admin and Operational Visibility

### Purpose

Operational/admin visibility is for debugging and system oversight, not user-facing message history.

### Admin areas

Django admin should expose:

* Devices
* Messages
* Events
* Global settings

### Useful admin filters

* by device
* by message type
* by status
* by time range

### Recommended logged events

* `message.created`
* `message.received`
* `message.presented`
* `message.opened`
* `device.connected`
* `device.disconnected`

---

## Technology Stack

### Backend

* Django
* Django Admin
* Django Ninja for JSON API
* plain Django view for SSE endpoint

### Database

* SQLite initially

### Security package

* django-axes for admin login throttling

### Future CLI

* Python
* interactive by default
* can reuse logic/schemas from Django project where practical

---

## CLI Direction (Later)

The CLI should be interactive-first.

Desired flow:

1. choose message type
2. enter content
3. choose recipient device from a list
4. confirm send

Additional design goals:

* searchable device selection
* support non-interactive flags later
* reuse API contracts and shared Python code where appropriate

---

## Testing Strategy

### Goals

A blank environment should be easy to spin up and test automatically.

Desired automated flow:

1. start app with empty database
2. bootstrap admin access
3. register or seed two devices
4. connect device stream(s)
5. send message from device A to device B
6. verify receipt/presentation/open flow
7. inspect logs/events

### Testing layers

* model/unit tests
* API integration tests
* end-to-end tests for send/receive flows

### Important design implication

Do not make SSE the only path to correctness.
HTTP APIs must support verification and recovery.

---

## Suggested Initial Build Order

1. Define models:

   * Device
   * Message
   * Event
   * Global settings
2. Configure Django admin
3. Add admin auth protection with django-axes
4. Implement device enrollment/auth
5. Build message send API
6. Build `/send` and `/hop` pages
7. Build inbox/message detail/open routes
8. Implement SSE stream
9. Add confirmation endpoints:

   * received
   * presented
   * opened
10. Add rate limiting and test utilities
11. Add browser notifications
12. Later add extension and CLI

---

## Open Questions / Deferred Items

These are intentionally deferred for later:

* browser extension implementation details
* PWA/mobile notification specifics
* long-term retention policy
* advanced message search/history UX
* richer message types beyond URL/text
* file transfer
* multi-user support
* WebSocket support

---

## Summary

LinkHop is a self-hosted, single-user, ephemeral message handoff service for personal devices.

It prioritizes:

* simple architecture
* reliable queued delivery
* extensionless usability
* good admin/debug visibility
* straightforward automation and testing

The system should feel lightweight and temporary:
messages are meant to get where they need to go, not live forever.
