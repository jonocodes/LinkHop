# LinkHop Progress Checklist

## Phase 0 — Project setup

* [ ] Create Django project and app structure
* [ ] Add Django Ninja
* [ ] Add django-axes
* [ ] Configure SQLite for local development
* [ ] Set up environment variable handling
* [ ] Create base settings for dev / test / prod
* [ ] Configure ASGI entrypoint for SSE support
* [ ] Set up formatting, linting, and test tools
* [ ] Create initial README with local run instructions

---

## Phase 1 — Core data model

* [ ] Create `Device` model
* [ ] Create `Message` model
* [ ] Create `Event` model
* [ ] Create global settings model
* [ ] Add message type enum: `url`, `text`
* [ ] Add message status fields / timestamps
* [ ] Add device auth token model or credential model
* [ ] Generate and apply initial migrations
* [ ] Register models in Django admin

### Validation rules

* [ ] Validate `url` messages only allow absolute `http` / `https` URLs
* [ ] Validate `text` messages allow multiline content
* [ ] Enforce explicit message type
* [ ] Add max URL length validation
* [ ] Add max text body size validation

---

## Phase 2 — Admin and settings

* [ ] Enable Django admin
* [ ] Configure django-axes for admin login throttling
* [ ] Verify admin login lockout behavior works
* [ ] Expose Devices in admin
* [ ] Expose Messages in admin
* [ ] Expose Events in admin
* [ ] Expose global settings in admin
* [ ] Add useful list filters for devices/messages/events
* [ ] Add useful search fields in admin
* [ ] Make global throttling values editable in admin

### Admin filters

* [ ] Filter messages by type
* [ ] Filter messages by status
* [ ] Filter messages by recipient device
* [ ] Filter events by event type
* [ ] Filter events by device
* [ ] Filter by time/date

---

## Phase 3 — Authentication and enrollment

* [ ] Add bootstrap admin secret flow for blank environment setup
* [ ] Implement admin login/session flow
* [ ] Implement device enrollment token model or mechanism
* [ ] Implement device registration endpoint
* [ ] Mint per-device bearer token on registration
* [ ] Store device token securely
* [ ] Add device token revocation support in admin
* [ ] Add device self-identification endpoint (`/api/device/me` or equivalent)

### Testability

* [ ] Add test-mode device seeding path or helper
* [ ] Ensure two devices can be registered entirely via automation
* [ ] Ensure blank environment bootstrap works without email

---

## Phase 4 — Core JSON API

* [ ] Create Django Ninja API router structure
* [ ] Add schema for device registration
* [ ] Add schema for device list
* [ ] Add schema for message creation
* [ ] Add schema for incoming message list
* [ ] Add schema for confirmation actions

### Device/API endpoints

* [ ] `POST /api/devices/register`
* [ ] `GET /api/devices`
* [ ] `GET /api/device/me`

### Message/API endpoints

* [ ] `POST /api/messages`
* [ ] `GET /api/messages/incoming`
* [ ] `POST /api/messages/{id}/received`
* [ ] `POST /api/messages/{id}/presented`
* [ ] `POST /api/messages/{id}/opened`

### Behavior

* [ ] Create `message.created` event on send
* [ ] Create `message.received` event on received signal
* [ ] Create `message.presented` event on presented signal
* [ ] Create `message.opened` event on opened signal
* [ ] Ensure clients can only act on their own incoming messages
* [ ] Ensure sender device is recorded when available

---

## Phase 5 — Web app send flow

* [ ] Create `/send` page
* [ ] Create `/hop` alias route
* [ ] Support `GET /send?type=url&body=...`
* [ ] Support `GET /send?type=text&body=...`
* [ ] Support `POST /send`
* [ ] Add dynamic device chooser
* [ ] Show device online/offline / last-seen hints
* [ ] Use single-line input for URL messages
* [ ] Use textarea for text messages
* [ ] Display validation errors clearly
* [ ] Show success state after send

### Extensionless operation

* [ ] Confirm full send flow works in a normal browser with no extension
* [ ] Confirm HTTP Shortcuts can open the send page with prefilled params

---

## Phase 6 — Inbox and message detail views

* [ ] Create inbox page for incoming messages
* [ ] Create URL open route: `GET /messages/{id}/open`
* [ ] Create text detail route: `GET /messages/{id}`
* [ ] Record opened signal before redirect/render
* [ ] Redirect URL messages to destination after open tracking
* [ ] Render text messages cleanly with preserved newlines
* [ ] Distinguish queued / received / presented / opened in UI where useful

---

## Phase 7 — SSE realtime delivery

* [ ] Create SSE endpoint
* [ ] Authenticate SSE requests with device token
* [ ] Emit `hello` event on connect
* [ ] Emit `message` event for newly available messages
* [ ] Emit periodic `ping` events
* [ ] Add automatic reconnect behavior client-side
* [ ] Re-sync pending messages on reconnect
* [ ] Dedupe messages by message ID client-side

### Connection behavior

* [ ] Record `device.connected` event
* [ ] Record `device.disconnected` event
* [ ] Enforce max active SSE streams per device
* [ ] Verify reconnects do not lose pending messages

---

## Phase 8 — Notifications

* [ ] Add browser notification support in web app
* [ ] Request notification permission in a reasonable UX flow
* [ ] Record `presented` when notification or visible UI presentation occurs
* [ ] Ensure notification click routes through tracked open flow
* [ ] Avoid duplicate notifications across multiple tabs where possible

### Priority rules

* [ ] Define extension-over-web-app priority rule in code/comments
* [ ] Ensure web app remains usable without extension

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
* [ ] Message validation tests
* [ ] Event creation tests
* [ ] Settings validation tests

### API integration tests

* [ ] Register device test
* [ ] Send URL message test
* [ ] Send text message test
* [ ] Received signal test
* [ ] Presented signal test
* [ ] Opened signal test
* [ ] Unauthorized access test
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

* [ ] Register devices
* [ ] Send URL and text messages
* [ ] Receive via inbox
* [ ] SSE delivery works
* [ ] Open/click tracking works
* [ ] Admin logs are usable
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
