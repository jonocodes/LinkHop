# LinkHop Implementation Guide

## Goal

This document converts the product docs into an implementation order that minimizes rework.

Read in this order:

1. `README.md` for the project summary
2. `PLAN.md` for product intent
3. `SPEC.md` for v1 source-of-truth behavior
4. `PROGRESS.md` for checklist tracking

---

## Recommended First Milestone

Build a thin vertical slice before tackling polish:

* register two devices
* send a message from one device to another through JSON API
* list incoming messages for the recipient
* mark a message as received/opened
* inspect all events in Django admin

Do not start with SSE, notifications, or polished web UX.

---

## Repository Setup

Recommended initial stack:

* Python `3.12`
* Django
* Django Ninja
* django-axes
* SQLite for local dev and tests

Recommended top-level layout:

```text
linkhop/
  manage.py
  pyproject.toml
  linkhop/
    settings/
    urls.py
    asgi.py
    wsgi.py
  core/
    models.py
    admin.py
    services/
    selectors/
    api/
    forms.py
    views.py
    tests/
```

Rationale:

* one app is enough for v1
* separate `services` and `selectors` early to avoid stuffing business logic into views

---

## Build Order

## 1. Project scaffolding

Create:

* Django project
* `core` app
* base/dev/test settings split
* `pyproject.toml`
* formatting and test tooling

Definition of done:

* app runs locally
* tests execute
* admin loads

## 2. Core models

Implement first:

* `Device`
* `EnrollmentToken`
* `Message`
* `Event`
* `GlobalSettings`

Make migrations immediately once the fields in `SPEC.md` are represented.

Definition of done:

* model validation tests pass
* models visible in admin

## 3. Admin operations

Add admin support for:

* devices
* messages
* events
* enrollment tokens
* global settings

Make the admin useful for debugging, not just present.

Add:

* list filters
* search fields
* read-only timestamps where appropriate
* token revocation controls

## 4. Auth and enrollment

Implement:

* bootstrap admin flow
* enrollment token creation
* device registration endpoint
* bearer-token authentication class for Ninja

Definition of done:

* a test can create an enrollment token and exchange it for a device token

## 5. Core JSON API

Implement in this order:

* `GET /api/device/me`
* `GET /api/devices`
* `POST /api/messages`
* `GET /api/messages/incoming`
* confirmation endpoints

Keep business logic out of route functions.

Recommended service functions:

* `register_device(...)`
* `create_message(...)`
* `list_incoming_messages(...)`
* `mark_message_received(...)`
* `mark_message_presented(...)`
* `mark_message_opened(...)`

## 6. Minimal web flow

After the API works, add:

* `/send`
* `/hop`
* `/messages/{id}`
* `/messages/{id}/open`

Keep templates minimal until the behavior is correct.

## 7. SSE

Only after the API is solid:

* add authenticated SSE stream
* emit `hello`, `message`, `ping`
* re-sync via HTTP on reconnect

Use SSE as a hint layer. Do not move authoritative state into the stream.

## 8. Notifications

Add browser notifications after inbox/open flows exist.

## 9. Retention and cleanup

Implement:

* expiration logic
* message pruning/expiry command or scheduled job
* event creation for expiration

---

## Implementation Conventions

### IDs

Use UUID primary keys for externally referenced models.

### Time

Store timezone-aware UTC timestamps everywhere.

### Token storage

Never store raw device tokens.

Use:

* strong random token generation
* one-way hash persisted in the database
* constant-time comparison where practical

### Service boundaries

Prefer:

* model validation for field-level correctness
* service functions for state transitions and event creation
* selectors/query helpers for common reads

Avoid:

* event creation spread across unrelated views
* direct state mutation from templates or route handlers

---

## Testing Strategy

Start writing tests as each layer lands.

Minimum required test groups:

* model validation tests
* service tests for message state transitions
* API auth tests
* API integration tests for send and confirm flows
* SSE smoke test later

Critical edge cases:

* invalid URL scheme
* blank text message
* sender targeting a nonexistent device
* recipient trying to access another device's message
* duplicate `received` or `opened` requests
* expired message no longer returned by incoming list

---

## Suggested Immediate Tasks

The first coding pass should produce:

* Django project scaffold
* core models and migrations
* admin registration
* bearer-token auth skeleton
* registration and message API endpoints
* tests for the happy path and auth boundaries

That is enough to prove the data model and delivery semantics before adding realtime behavior.
