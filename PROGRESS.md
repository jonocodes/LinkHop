# LinkHop Progress Checklist

## Phase 0 — Project setup

* [x] Create Django project and app structure
* [x] Add Django Ninja
* [x] Add django-axes
* [x] Configure SQLite for local development
* [x] Set up environment variable handling
* [x] Create base settings for dev / test / prod
* [x] Configure ASGI entrypoint for SSE support
* [x] Set up formatting, linting, and test tools
* [x] Expand README with local run instructions once the app is runnable

---

## Phase 1 — Core data model

* [x] Create `Device` model
* [x] Create `Message` model
* [x] Create `Event` model
* [x] Create global settings model
* [x] Add message type enum: `url`, `text`
* [x] Add message status fields / timestamps
* [x] Add device auth token model or credential model
* [x] Generate and apply initial migrations
* [x] Register models in Django admin

### Validation rules

* [x] Validate `url` messages only allow absolute `http` / `https` URLs
* [x] Validate `text` messages allow multiline content
* [x] Enforce explicit message type
* [x] Add max URL length validation
* [x] Add max text body size validation
* [x] Define message retention / expiry rules consistent with ephemeral delivery

---

## Phase 2 — Admin and settings

* [x] Enable Django admin
* [x] Configure django-axes for admin login throttling
* [ ] Verify admin login lockout behavior works
* [x] Expose Devices in admin
* [x] Expose Messages in admin
* [x] Expose Events in admin
* [x] Expose global settings in admin
* [x] Add useful list filters for devices/messages/events
* [x] Add useful search fields in admin
* [x] Make global throttling values editable in admin
* [x] Add "Send test message" admin action on Device (sends test text message to selected device)

### Admin filters

* [x] Filter messages by type
* [x] Filter messages by status
* [x] Filter messages by recipient device
* [x] Filter events by event type
* [x] Filter events by device
* [x] Filter by time/date

---

## Phase 3 — Authentication and enrollment

* [ ] Add bootstrap admin secret flow for blank environment setup
* [x] Implement admin login/session flow
* [x] Implement device enrollment token model or mechanism
* [x] Implement device registration endpoint
* [x] Mint per-device bearer token on registration
* [x] Store device token securely
* [ ] Add device token revocation support in admin
* [x] Add device self-identification endpoint (`/api/device/me` or equivalent)
* [x] `/connect` page for device users to enter their token and get a session cookie
* [x] `/disconnect` page to clear device session cookie
* [x] `@device_login_required` decorator for web views (separate from admin `@login_required`)
* [x] Device auth cookie (`linkhop_device`, httponly, 1 year) — no admin session required

### Testability

* [x] Add test-mode device seeding path or helper
* [x] Ensure two devices can be registered entirely via automation
* [ ] Ensure blank environment bootstrap works without email

---

## Phase 4 — Core JSON API

* [x] Create Django Ninja API router structure
* [x] Add schema for device registration
* [x] Add schema for device list
* [x] Add schema for message creation
* [x] Add schema for incoming message list
* [x] Add schema for confirmation actions

### Device/API endpoints

* [x] `POST /api/devices/register`
* [x] `GET /api/devices`
* [x] `GET /api/device/me`

### Message/API endpoints

* [x] `POST /api/messages`
* [x] `GET /api/messages/incoming`
* [x] `POST /api/messages/{id}/received`
* [x] `POST /api/messages/{id}/presented`
* [x] `POST /api/messages/{id}/opened`

### Behavior

* [x] Create `message.created` event on send
* [x] Create `message.received` event on received signal
* [x] Create `message.presented` event on presented signal
* [x] Create `message.opened` event on opened signal
* [x] Ensure clients can only act on their own incoming messages
* [x] Ensure sender device is recorded when available
* [x] Define idempotent behavior for duplicate confirmation requests

---

## Phase 5 — Web app send flow

* [x] Create `/send` page
* [x] Create `/hop` alias route
* [x] Support `GET /send?type=url&body=...`
* [x] Support `GET /send?type=text&body=...`
* [x] Support `POST /send`
* [x] Add dynamic device chooser
* [x] Show device online/offline / last-seen hints
* [x] Use single-line input for URL messages
* [x] Use textarea for text messages
* [x] Display validation errors clearly
* [x] Show success state after send

### Extensionless operation

* [ ] Confirm full send flow works in a normal browser with no extension
* [ ] Confirm HTTP Shortcuts can open the send page with prefilled params

---

## Phase 6 — Inbox and message detail views

* [x] Create inbox page for incoming messages
* [x] Create URL open route: `GET /messages/{id}/open`
* [x] Create text detail route: `GET /messages/{id}`
* [x] Record opened signal before redirect/render
* [x] Redirect URL messages to destination after open tracking
* [x] Render text messages cleanly with preserved newlines
* [x] Distinguish queued / received / presented / opened in UI where useful
* [x] Filter out `opened` messages from inbox
* [x] bfcache fix: reload inbox on `pageshow` when `event.persisted`

---

## Phase 7 — SSE realtime delivery

* [x] Create SSE endpoint
* [x] Authenticate SSE requests with device token
* [x] Emit `hello` event on connect
* [x] Emit `message` event for newly available messages
* [x] Emit periodic `ping` events
* [x] Add automatic reconnect behavior client-side
* [x] Re-sync pending messages on reconnect
* [x] Dedupe messages by message ID client-side

### Connection behavior

* [x] Record `device.connected` event
* [x] Record `device.disconnected` event
* [x] Enforce max active SSE streams per device
* [x] Verify reconnects do not lose pending messages
* [x] Define reconnect/backoff expectations for clients

---

## Phase 8 — Notifications

* [x] Add browser notification support in web app
* [x] Request notification permission in a reasonable UX flow
* [x] Record `presented` when notification or visible UI presentation occurs
* [x] Ensure notification click routes through tracked open flow
* [x] Avoid duplicate notifications across multiple tabs where possible

### Priority rules

* [x] Define extension-over-web-app priority rule in code/comments
* [x] Ensure web app remains usable without extension

---

## Phase 9 — Security and throttling

* [ ] Add global settings for throttling values
* [ ] Add rate limiting for message send endpoint
* [ ] Add rate limiting for received/presented/opened endpoints
* [ ] Add rate limiting for device registration flow
* [ ] Add request size/content limits
* [ ] Add URL/body length enforcement in API and forms
* [ ] Add revocation checks for device tokens on every authenticated request

### Security checks

* [ ] Confirm only `http` and `https` URLs are allowed
* [ ] Confirm devices cannot read other devices’ incoming messages
* [ ] Confirm devices cannot confirm/open messages not addressed to them
* [ ] Confirm revoked tokens stop working immediately
* [ ] Confirm expired or pruned messages behave predictably for clients

---

## Phase 10 — Logging and operational visibility

* [ ] Ensure all key events are persisted
* [ ] Verify logs are visible and useful in admin
* [ ] Add message/event correlation where needed
* [ ] Verify device status / last seen updates correctly
* [ ] Make troubleshooting a failed send possible from admin alone

### Expected events

* [ ] `message.created`
* [ ] `message.received`
* [ ] `message.presented`
* [ ] `message.opened`
* [ ] `device.connected`
* [ ] `device.disconnected`

---

## Phase 11 — Automated testing

### Unit tests

* [ ] Device model tests
* [x] Message validation tests
* [ ] Event creation tests
* [ ] Settings validation tests

### API integration tests

* [x] Register device test
* [x] Send URL message test
* [x] Send text message test
* [x] Received signal test
* [ ] Presented signal test
* [x] Opened signal test
* [x] Unauthorized access test
* [ ] Rate limit behavior test

### End-to-end tests

* [ ] Start blank environment
* [ ] Bootstrap admin
* [ ] Auto-register device A
* [ ] Auto-register device B
* [ ] Connect recipient SSE stream
* [ ] Send message from A to B
* [ ] Verify B receives notification/event
* [ ] Verify B can open/click message
* [ ] Verify expected events appear in logs

---

## Phase 12 — Release readiness

* [ ] Write deployment instructions
* [ ] Document required environment variables
* [ ] Document reverse proxy notes for admin/auth/IP handling
* [ ] Document retention / cleanup behavior for ephemeral messages
* [ ] Document backup strategy for SQLite
* [ ] Document how to revoke/re-register a device
* [ ] Document HTTP Shortcuts integration example
* [ ] Document API examples for send flow

---

## Later / Nice-to-have

* [ ] Browser extension support
* [ ] Multi-tab notification leader election improvements
* [ ] CLI implementation in Python
* [ ] Interactive CLI device picker
* [ ] Non-interactive CLI flags
* [ ] PWA/mobile notification exploration
* [ ] Retention/cleanup policy refinement
* [ ] Better message search/filtering outside admin

---

## Milestone definitions

### MVP milestone

* [x] Register devices
* [x] Send URL and text messages
* [x] Receive via inbox
* [x] SSE delivery works
* [x] Open/click tracking works
* [x] Admin logs are usable
* [ ] Automated end-to-end test passes

### Post-MVP milestone

* [ ] Browser notifications polished
* [ ] Throttling fully configurable in admin
* [ ] Operational docs complete
* [ ] HTTP Shortcuts workflow polished
* [ ] Extension groundwork prepared

---

## Later Detailed Specs

### Browser extension spec (later)

* [ ] Define extension goals and non-goals
* [ ] Define how extension links to an existing device identity
* [ ] Define extension auth/bootstrap flow
* [ ] Define extension priority behavior over web app in same browser context
* [ ] Define extension send UX for current tab / page / selection
* [ ] Define extension receive UX for notifications and inbox handoff
* [ ] Define how extension records received/presented/opened signals
* [ ] Define how extension and web app avoid duplicate notifications
* [ ] Define extension reconnect / offline behavior
* [ ] Define extension testing approach

### PWA / mobile web spec (later)

* [ ] Define whether PWA install is recommended or optional
* [ ] Define mobile notification goals and constraints
* [ ] Define Web Push / notification support strategy
* [ ] Define mobile send flow details beyond HTTP Shortcuts
* [ ] Define mobile receive/inbox flow
* [ ] Define mobile click/open tracking behavior
* [ ] Define background/reconnect expectations on mobile
* [ ] Define how PWA/web notifications interact with extension priority rules
* [ ] Define PWA testing strategy

### CLI spec (later)

* [ ] Define Python packaging and distribution approach
* [ ] Define shared code reuse with Django app where practical
* [ ] Define interactive prompt flow in detail
* [ ] Define searchable device picker behavior
* [ ] Define non-interactive/scripted usage options
* [ ] Define auth flow for CLI device identity
* [ ] Define send and inbox command set
* [ ] Define CLI testing strategy

---

## Notes

Use this checklist as a living progress tracker.

Suggested workflow:

* mark items complete as implemented
* add links to PRs/issues beside items if useful
* split large checklist items into implementation tickets as needed
