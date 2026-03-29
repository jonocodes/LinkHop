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
* [x] Admin virtual device ("Admin") as sender for system-generated messages
* [x] Connected devices page with three-state presence (online/recently seen/offline)
* [x] "Add device" flow in admin with pairing PIN generation (PRG pattern, session-stored PIN)
* [x] Per-device "Send test" button on connected devices page
* [x] Admin sidebar "Open app" link (opens in new tab)
* [ ] Restyle the admin migration-pending warning so it renders as a clear banner in the Unfold admin theme

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

### Device pairing endpoints

* [x] `POST /api/pairings/pin`
* [x] `POST /api/pairings/pin/register`

### Message/API endpoints

* [x] `POST /api/messages`
* [x] `GET /api/messages/incoming`
* [x] `GET /api/messages/{id}`
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
* [x] Show device online/offline / last-seen hints (three-state: online/recently seen/offline)
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

* [x] Add global settings for throttling values
* [x] Add rate limiting for message send endpoint
* [x] Add rate limiting for received/presented/opened endpoints
* [x] Add rate limiting for device registration flow
* [x] Add request size/content limits
* [x] Add URL/body length enforcement in API and forms
* [x] Add revocation checks for device tokens on every authenticated request

### Security checks

* [x] Confirm only `http` and `https` URLs are allowed
* [x] Confirm devices cannot read other devices' incoming messages
* [x] Confirm devices cannot confirm/open messages not addressed to them
* [x] Confirm revoked tokens stop working immediately
* [x] Confirm expired or pruned messages behave predictably for clients

---

## Phase 10 — Logging and operational visibility

* [x] Ensure all key events are persisted
* [x] Verify logs are visible and useful in admin
* [x] Add message/event correlation where needed
* [x] Verify device status / last seen updates correctly
* [x] Make troubleshooting a failed send possible from admin alone

### Expected events

* [x] `message.created`
* [x] `message.received`
* [x] `message.presented`
* [x] `message.opened`
* [x] `device.connected`
* [x] `device.disconnected`

---

## Phase 11 — Automated testing

### Unit tests

* [x] Device model tests (creation, uniqueness, revocation, timestamps)
* [x] Message validation tests
* [x] Event creation tests
* [x] Settings validation tests (singleton, defaults, toggles)

### API integration tests

* [x] Register device test
* [x] Send URL message test
* [x] Send text message test
* [x] Received signal test
* [x] Presented signal test
* [x] Opened signal test
* [x] Unauthorized access test
* [x] Rate limit behavior test
* [x] Security tests (revoked/inactive devices, URL validation, length limits)

### End-to-end tests

#### API Flow Tests
* [x] Start blank environment
* [x] Bootstrap admin
* [x] Auto-register device A
* [x] Auto-register device B
* [x] Send message from A to B
* [x] Verify B receives notification/event
* [x] Verify B can open/click message
* [x] Verify expected events appear in logs
* [x] Message expiration behavior test
* [x] Device listing test
* [x] Self-send prevention (default)
* [x] Self-send allowed when enabled
* [x] Multiple messages to same recipient
* [x] Device self-identification
* [x] Revoked device cannot authenticate
* [x] Admin can view all data
* [x] Invalid enrollment token rejection
* [x] Duplicate device name rejection

#### Web Interface Tests
* [x] Connect page flow (connect/disconnect)
* [x] Send page URL flow via web form
* [x] Send page with prefilled URL parameters
* [x] Inbox displays incoming messages
* [x] URL open redirects and tracks
* [x] Text message detail view

#### Concurrent Operations Tests
* [x] Multiple devices can send concurrently
* [x] Message delivery order preserved

#### Error Handling Tests
* [x] Cannot access other device messages
* [x] Invalid message types rejected

#### Event Logging Verification Tests
* [x] All event types logged for complete flow
* [x] Device events logged on connection

#### Admin Operations Tests
* [x] Admin can send test message via action
* [x] Admin can filter and search devices
* [x] Admin can view message details

---

## Phase 12 — Release readiness

### Documentation

* [x] Write deployment instructions (`docs/DEPLOYMENT.md`)
* [x] Document required environment variables (`docs/ENVIRONMENT.md`)
* [x] Document reverse proxy notes for admin/auth/IP handling (`docs/DEPLOYMENT.md`, `nginx/`)
* [x] Document retention / cleanup behavior for ephemeral messages (`docs/BACKUP.md`)
* [x] Document backup strategy for SQLite (`docs/BACKUP.md`)
* [x] Document how to revoke/re-register a device (`docs/DEVICE_MANAGEMENT.md`)
* [x] Document HTTP Shortcuts integration example (`docs/HTTP_SHORTCUTS.md`)
* [x] Document API examples for send flow (`docs/API.md`)

### Docker Support

* [x] Create Dockerfile
* [x] Create docker-compose.yml with nginx reverse proxy
* [x] Create docker-compose.override.yml for development
* [x] Create .env.example
* [x] Create .dockerignore
* [x] Configure nginx for production deployment
* [x] Add health checks
* [x] Support for Let's Encrypt SSL certificates

### Files Created

```
Dockerfile                          # Multi-stage production build
docker-compose.yml                  # Production orchestration
docker-compose.override.yml         # Development overrides
.env.example                        # Environment template
.dockerignore                       # Docker build exclusions

nginx/
├── nginx.conf                      # Main nginx config
└── conf.d/
    └── default.conf               # Site configuration

docs/
├── DEPLOYMENT.md                   # Deployment guide
├── ENVIRONMENT.md                  # Environment variables
├── API.md                          # API documentation
├── HTTP_SHORTCUTS.md              # Mobile integration
├── BACKUP.md                       # Backup & maintenance
└── DEVICE_MANAGEMENT.md           # Device management
```

---

## Later / Nice-to-have

* [x] Browser extension spec complete (implementation ready)
* [ ] Multi-tab notification leader election improvements
* [x] CLI spec complete (implementation ready)
* [x] PWA spec complete (implementation ready)
* [ ] Retention/cleanup policy refinement
* [ ] Better message search/filtering outside admin
* [x] Ping server: text message "ping server" triggers auto-reply "pong (server)" from Admin device
* [ ] Fix "ping client" auto-respond — SSE client JS fetches the message and POSTs pong but response never arrives; CSRF exempt fix applied, still not working — needs further debugging

---

## Milestone definitions

### MVP milestone

* [x] Register devices
* [x] Send URL and text messages
* [x] Receive via inbox
* [x] SSE delivery works
* [x] Open/click tracking works
* [x] Admin logs are usable
* [x] Automated end-to-end test passes

### Post-MVP milestone

* [x] Browser notifications polished
* [x] Throttling fully configurable in admin
* [x] Operational docs complete
* [x] HTTP Shortcuts workflow polished
* [x] Extension groundwork prepared

---

## Later Detailed Specs

### Browser extension spec

* [x] Define extension goals and non-goals
* [x] Define how extension links to an existing device identity
* [x] Define extension auth/bootstrap flow
* [x] Define extension priority behavior over web app in same browser context
* [x] Define extension send UX for current tab / page / selection
* [x] Define extension receive UX for notifications and inbox handoff
* [x] Define how extension records received/presented/opened signals
* [x] Define how extension and web app avoid duplicate notifications
* [x] Define extension reconnect / offline behavior
* [x] Define extension testing approach

**Document:** `docs/EXTENSION_SPEC.md`

### PWA / mobile web spec

* [x] Define whether PWA install is recommended or optional
* [x] Define mobile notification goals and constraints
* [x] Define Web Push / notification support strategy
* [x] Define mobile send flow details beyond HTTP Shortcuts
* [x] Define mobile receive/inbox flow
* [x] Define mobile click/open tracking behavior
* [x] Define background/reconnect expectations on mobile
* [x] Define how PWA/web notifications interact with extension priority rules
* [x] Define PWA testing strategy

**Document:** `docs/PWA_SPEC.md`

### CLI spec

* [x] Define Python packaging and distribution approach
* [x] Define shared code reuse with Django app where practical
* [x] Define interactive prompt flow in detail
* [x] Define searchable device picker behavior
* [x] Define non-interactive/scripted usage options
* [x] Define auth flow for CLI device identity
* [x] Define send and inbox command set
* [x] Define CLI testing strategy

**Document:** `docs/CLI_SPEC.md`

---

## Test Suite Summary

**Total Tests: 122** (all passing ✅)

| Test File | Test Count | Coverage Area |
|-----------|------------|---------------|
| `test_api.py` | 8 | API integration flows |
| `test_e2e.py` | 46 | End-to-end user journeys |
| `test_models.py` | 16 | Model validation & behavior |
| `test_selectors.py` | 13 | Selector / presence logic |
| `test_security.py` | 6 | Security & rate limiting |
| `test_settings.py` | 15 | Global settings validation |
| `test_sse.py` | 18 | SSE stream behavior |

### E2E Test Coverage

**API Flow Tests**
- Device registration and authentication (pairing PIN flow)
- Message sending and receiving
- Status transitions (received → presented → opened)
- Self-send prevention and configuration
- Device revocation and security
- Admin operations

**Web Interface Tests**
- Connect/disconnect cookie flow
- Send page with form submission
- Prefilled URL parameters
- Inbox message display
- URL open with tracking
- Text message detail view
- Hop view (bookmarklet entry point)

**Ping / Auto-respond Tests**
- Ping server: auto-replies with "pong (server)" on commit
- Ping server: case-insensitive match
- Ping server: only triggers on text type (not URL)
- Ping server: exact match only (no partial match)
- Ping server pong appears in sender's inbox
- Message GET endpoint returns message for recipient
- Message GET endpoint returns 403 for wrong device
- Ping client: manual simulation of client-side auto-respond

**Concurrent Operations**
- Multiple devices sending simultaneously
- Message delivery order preservation

**Error Handling**
- Cross-device message access prevention
- Invalid message type rejection

**Event Logging**
- Complete flow event capture
- Device connection events

**Admin Operations**
- Test message action
- Device filtering and search
- Message detail viewing

---

## Notes

Use this checklist as a living progress tracker.

Suggested workflow:

* mark items complete as implemented
* add links to PRs/issues beside items if useful
* split large checklist items into implementation tickets as needed
