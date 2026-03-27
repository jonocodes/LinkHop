# LinkHop Test Documentation

Complete reference guide for all automated tests in the LinkHop project.

**Last Updated:** 2026-03-26  
**Total Tests:** 60

---

## Quick Reference

| Test File | Count | Focus Area |
|-----------|-------|------------|
| `test_api.py` | 4 | API endpoint integration |
| `test_e2e.py` | 31 | End-to-end user workflows |
| `test_models.py` | 11 | Data model validation |
| `test_security.py` | 8 | Security and rate limiting |
| `test_settings.py` | 6 | Global settings validation |

---

## Test Categories

### 1. API Integration Tests (`test_api.py`)

Tests for API endpoint functionality and integration.

#### `test_register_device_returns_bearer_token`
**Purpose:** Verify device registration flow works end-to-end  
**What it tests:**
- Creating an enrollment token
- Using enrollment token to register a device
- Receiving a valid bearer token in response
- Device is created in database

**Why it matters:** Core authentication flow - if this fails, no devices can connect.

---

#### `test_message_flow_creates_events_and_allows_confirmation`
**Purpose:** Test complete message lifecycle through API  
**What it tests:**
- Device registration (sender and recipient)
- Sending a message via API
- Message appears in recipient's inbox
- Marking message as received/presented/opened
- Events are created for each state change

**Why it matters:** Validates the entire message delivery pipeline.

---

#### `test_invalid_token_cannot_access_authenticated_endpoint`
**Purpose:** Ensure authentication is enforced  
**What it tests:**
- Using invalid/expired token returns 401
- No access to protected endpoints without valid token

**Why it matters:** Security - prevents unauthorized access.

---

#### `test_device_cannot_open_other_devices_message`
**Purpose:** Test access control boundaries  
**What it tests:**
- Device A sends to Device B
- Device C tries to mark message as opened
- Request is rejected (403 Forbidden)
- Only recipient can open their messages

**Why it matters:** Privacy - devices can't access each other's messages.

---

### 2. End-to-End Tests (`test_e2e.py`)

Complete user journey tests from blank slate to working system.

#### Environment Setup Tests

##### `test_blank_environment_starts_clean`
**Purpose:** Verify test isolation  
**What it tests:**
- No devices exist at start
- No users exist at start
- No messages or events exist

**Why it matters:** Ensures each test starts fresh without data leakage.

---

##### `test_bootstrap_admin_creation`
**Purpose:** Test admin user setup  
**What it tests:**
- Creating a superuser via Django API
- User has correct permissions (is_superuser, is_staff)

**Why it matters:** Admin access is required for system management.

---

#### Device Registration Tests

##### `test_auto_register_two_devices_via_api`
**Purpose:** Test multi-device registration  
**What it tests:**
- Creating two enrollment tokens
- Registering Device A with token
- Registering Device B with different token
- Both devices exist and are distinct

**Why it matters:** Most common use case - phone + laptop setup.

---

##### `test_invalid_enrollment_token_rejected`
**Purpose:** Test enrollment security  
**What it tests:**
- Using invalid/non-existent enrollment token
- API returns 400 with "invalid_enrollment_token" error

**Why it matters:** Prevents brute force registration attempts.

---

##### `test_duplicate_device_name_rejected`
**Purpose:** Test device name uniqueness  
**What it tests:**
- Registering device with name "Same Name"
- Attempting to register another with same name
- Second registration fails with "device_name_conflict"

**Why it matters:** Device names must be unique for clear identification.

---

##### `test_empty_device_name_handled`
**Purpose:** Document current behavior for edge cases  
**What it tests:**
- Using valid device name (shows current behavior)

**Why it matters:** Documents that whitespace names currently work (may change).

---

#### Message Flow Tests

##### `test_complete_message_flow`
**Purpose:** Full integration test of URL sending  
**What it tests:**
- Bootstrap admin creation
- Register two devices (A and B)
- Send URL from A to B via API
- Verify message in database
- B fetches message from inbox
- B marks message as opened
- Verify `message.created` and `message.opened` events logged

**Why it matters:** The "happy path" - tests everything working together.

---

##### `test_text_message_complete_flow`
**Purpose:** Full integration test of text sending  
**What it tests:**
- Register sender and recipient
- Send text message
- Mark as received (B confirms receipt)
- Mark as presented (B shows notification)
- Mark as opened (B reads message)
- All four events logged (created, received, presented, opened)

**Why it matters:** Text messages have more states than URLs.

---

##### `test_multiple_messages_to_same_recipient`
**Purpose:** Test batch message handling  
**What it tests:**
- Send 3 messages from A to B
- Verify all 3 appear in B's inbox
- Correct message count returned

**Why it matters:** Real-world usage involves multiple messages.

---

##### `test_message_delivery_order_preserved`
**Purpose:** Test message sequencing  
**What it tests:**
- Send 5 messages in specific order
- Fetch inbox
- Verify messages returned in creation order

**Why it matters:** Messages should arrive in order they were sent.

---

##### `test_message_expiration_behavior`
**Purpose:** Test message lifecycle cleanup  
**What it tests:**
- Send message with normal expiry
- Manually expire the message (set expiry in past)
- Message no longer appears in inbox

**Why it matters:** Expired messages shouldn't clutter the inbox.

---

#### Self-Send Tests

##### `test_self_send_prevented_by_default`
**Purpose:** Test default self-send restriction  
**What it tests:**
- Device tries to send message to itself
- Request rejected with 400 error
- "validation_error" code returned

**Why it matters:** Prevents accidental self-messaging (can be enabled in settings).

---

##### `test_self_send_allowed_when_enabled`
**Purpose:** Test self-send configuration  
**What it tests:**
- Enable `allow_self_send` in GlobalSettings
- Device sends message to itself
- Request succeeds (201)

**Why it matters:** Some users may want to send notes to themselves.

---

#### Device Management Tests

##### `test_device_self_identification`
**Purpose:** Test device info endpoint  
**What it tests:**
- Device calls `/api/device/me`
- Returns correct device name, ID, active status

**Why it matters:** Devices need to know their own identity.

---

##### `test_device_can_list_other_active_devices`
**Purpose:** Test device discovery  
**What it tests:**
- Register Device A and B
- A fetches device list
- B appears in the list
- List contains both devices

**Why it matters:** Users need to see available recipients.

---

##### `test_revoked_device_cannot_authenticate`
**Purpose:** Test device revocation  
**What it tests:**
- Register Device A and B
- Revoke Device B (set revoked_at)
- A tries to send to B - fails (recipient not found)
- B tries to authenticate - fails (401)

**Why it matters:** Revoked devices should immediately lose access.

---

#### Security Tests

##### `test_cannot_access_other_device_messages`
**Purpose:** Test cross-device access prevention  
**What it tests:**
- Device A sends to Device B
- Device C tries to open the message
- Request rejected (403 Forbidden)
- C's inbox doesn't show the message

**Why it matters:** Privacy isolation between devices.

---

##### `test_invalid_message_types_rejected`
**Purpose:** Test input validation  
**What it tests:**
- Try to send message with type "invalid_type"
- Request rejected with 400 error

**Why it matters:** Prevents malformed data from entering system.

---

#### Admin Tests

##### `test_admin_can_view_all_data`
**Purpose:** Test admin capabilities  
**What it tests:**
- Create admin user
- Register devices and send messages
- Admin login succeeds
- Can view admin dashboard
- Database contains expected data

**Why it matters:** Admins need visibility into system state.

---

##### `test_admin_can_send_test_message_via_action`
**Purpose:** Test admin "Send Test Message" action  
**What it tests:**
- Admin logs in
- Register a device
- Use admin action to send test message
- Message appears in database

**Why it matters:** Admin troubleshooting feature works.

---

##### `test_admin_can_filter_and_search_devices`
**Purpose:** Test admin UI functionality  
**What it tests:**
- Create admin
- Register multiple devices
- Access admin device list
- Search/filter works

**Why it matters:** Admin needs tools to manage many devices.

---

##### `test_admin_can_view_message_details`
**Purpose:** Test admin message inspection  
**What it tests:**
- Create admin
- Send a message via API
- Access message detail in admin
- View message content

**Why it matters:** Admin needs to inspect messages for support.

---

#### Concurrent Operations Tests

##### `test_multiple_devices_can_send_concurrently`
**Purpose:** Test system under concurrent load  
**What it tests:**
- Create 3 devices
- Each device sends to all others simultaneously
- All 6 messages created successfully

**Why it matters:** Real usage involves concurrent operations.

---

#### Event Logging Tests

##### `test_all_event_types_logged_for_complete_flow`
**Purpose:** Verify audit trail completeness  
**What it tests:**
- Complete message flow (created → received → presented → opened)
- Verify all 4 event types exist in database
- Events have correct device associations

**Why it matters:** Audit trail is crucial for debugging and analytics.

---

##### `test_device_events_logged_on_connection`
**Purpose:** Test connection tracking  
**What it tests:**
- Register device
- Connect via web interface
- Verify connection flow works

**Why it matters:** Track device activity and engagement.

---

#### Web Interface Tests

##### `test_web_connect_page_flow`
**Purpose:** Test web authentication flow  
**What it tests:**
- Visit `/connect` page
- Submit device token
- Redirected to `/inbox`
- Can access inbox
- Disconnect works
- After disconnect, redirected to connect

**Why it matters:** Web interface is primary user entry point.

---

##### `test_web_send_page_url_flow`
**Purpose:** Test web send form  
**What it tests:**
- Register devices via API
- Connect sender via web
- Access `/send` page
- Submit URL message via form
- Message created successfully

**Why it matters:** Web send form is used by browser users.

---

##### `test_web_send_page_with_prefilled_params`
**Purpose:** Test URL parameter prefill  
**What it tests:**
- Access `/send?type=url&body=https://example.com`
- URL is pre-filled in form

**Why it matters:** Enables integrations (bookmarklets, share buttons).

---

##### `test_web_inbox_displays_messages`
**Purpose:** Test inbox web interface  
**What it tests:**
- Send message via API
- Connect recipient via web
- Inbox page displays the message

**Why it matters:** Web inbox shows incoming messages.

---

##### `test_web_url_open_redirects_and_tracks`
**Purpose:** Test URL open tracking  
**What it tests:**
- Send URL message
- Connect recipient
- Visit `/messages/{id}/open`
- Redirected to target URL
- Message marked as opened in database

**Why it matters:** Tracks when users actually open links.

---

##### `test_web_text_message_detail_view`
**Purpose:** Test text message viewing  
**What it tests:**
- Send text message
- Connect recipient
- Visit message detail page
- Text content displayed
- Message marked as opened

**Why it matters:** Text messages need readable display.

---

### 3. Model Tests (`test_models.py`)

Tests for Django model validation and behavior.

#### Device Model Tests

##### `test_device_creation`
**Purpose:** Test basic device creation  
**What it tests:**
- Create device with name and token hash
- Device has correct properties
- Active by default
- No revocation or last seen timestamp

**Why it matters:** Basic model integrity.

---

##### `test_device_name_uniqueness`
**Purpose:** Test name constraint  
**What it tests:**
- Create device with unique name
- Try to create another with same name
- Second creation raises IntegrityError

**Why it matters:** Prevents duplicate device names.

---

##### `test_device_revocation`
**Purpose:** Test revocation tracking  
**What it tests:**
- Create device
- Set revoked_at timestamp
- Save and refresh
- Verify revoked_at is persisted

**Why it matters:** Revocation must be persistent.

---

##### `test_device_token_hash_uniqueness`
**Purpose:** Test token hash constraint  
**What it tests:**
- Create device with token hash
- Try to create another with same hash
- Second creation raises IntegrityError

**Why it matters:** Each device needs unique token.

---

##### `test_device_str_representation`
**Purpose:** Test string representation  
**What it tests:**
- Device string is the device name

**Why it matters:** Used in admin and logs.

---

##### `test_device_timestamps`
**Purpose:** Test automatic timestamps  
**What it tests:**
- Device has created_at timestamp
- Device has updated_at timestamp

**Why it matters:** Audit trail for device lifecycle.

---

#### Message Model Tests

##### `test_url_message_requires_absolute_http_or_https_url`
**Purpose:** Test URL validation  
**What it tests:**
- Create URL message with ftp:// URL
- Validation fails with ValidationError

**Why it matters:** Only HTTP/HTTPS URLs allowed for security.

---

##### `test_text_message_cannot_be_blank`
**Purpose:** Test text validation  
**What it tests:**
- Create text message with whitespace only
- Validation fails

**Why it matters:** Empty messages are not useful.

---

##### `test_valid_text_message_passes_validation`
**Purpose:** Test valid text acceptance  
**What it tests:**
- Create text message with normal content (including newlines)
- Validation passes

**Why it matters:** Normal usage should work.

---

##### `test_message_str_representation`
**Purpose:** Test message string format  
**What it tests:**
- Message string is "type:id" format

**Why it matters:** Used in debugging and admin.

---

##### `test_message_is_expired`
**Purpose:** Test expiration logic  
**What it tests:**
- New message is not expired
- Set expiry in past
- Message is now expired

**Why it matters:** Expiration logic used for cleanup.

---

### 4. Security Tests (`test_security.py`)

Tests for security features and rate limiting.

#### Authentication Security

##### `test_device_with_revoked_token_cannot_authenticate`
**Purpose:** Test revoked token rejection  
**What it tests:**
- Register device
- Revoke the device
- Try to access authenticated endpoint
- Returns 401 Unauthorized

**Why it matters:** Revoked devices must be immediately blocked.

---

##### `test_device_with_inactive_flag_cannot_authenticate`
**Purpose:** Test inactive device rejection  
**What it tests:**
- Register device
- Set is_active = False
- Try to access authenticated endpoint
- Returns 401 Unauthorized

**Why it matters:** Disabled devices must be blocked.

---

#### Input Validation

##### `test_url_validation_only_allows_http_and_https`
**Purpose:** Test URL scheme validation  
**What it tests:**
- Try to send ftp:// URL via API
- Request rejected with validation_error

**Why it matters:** Security - prevent malicious schemes.

---

##### `test_url_length_validation`
**Purpose:** Test URL length limits  
**What it tests:**
- Try to send URL > 2048 characters
- Request rejected with validation_error

**Why it matters:** Prevent abuse and ensure browser compatibility.

---

##### `test_text_length_validation`
**Purpose:** Test text length limits  
**What it tests:**
- Try to send text > 8000 characters
- Request rejected with validation_error

**Why it matters:** Prevent abuse and manage storage.

---

##### `test_blank_text_message_is_rejected`
**Purpose:** Test blank text rejection  
**What it tests:**
- Try to send whitespace-only text
- Request rejected with validation_error

**Why it matters:** Blank messages are not useful.

---

#### Event Logging

##### `test_message_created_event_is_logged`
**Purpose:** Test event creation on send  
**What it tests:**
- Send message via API
- Verify `message.created` event exists
- Event linked to sender device

**Why it matters:** Audit trail starts at creation.

---

##### `test_message_status_events_are_logged`
**Purpose:** Test event creation on state changes  
**What it tests:**
- Send message
- Mark as received, presented, opened
- Verify all 4 event types exist

**Why it matters:** Complete audit trail for message lifecycle.

---

### 5. Settings Tests (`test_settings.py`)

Tests for GlobalSettings model and configuration.

##### `test_singleton_creation`
**Purpose:** Test settings creation  
**What it tests:**
- Create GlobalSettings with all fields
- Verify values are stored correctly

**Why it matters:** Settings must be persistable.

---

##### `test_default_values`
**Purpose:** Test default settings  
**What it tests:**
- Create settings with only singleton_key
- Verify defaults are applied:
  - 7 day retention
  - 30 sends/minute
  - 120 confirmations/minute
  - 10 registrations/hour
  - 5 SSE streams
  - 500 pending messages
  - Self-send disabled

**Why it matters:** Sensible defaults for new installations.

---

##### `test_singleton_key_uniqueness`
**Purpose:** Test singleton constraint  
**What it tests:**
- Create settings with key "default"
- Try to create another with same key
- Second creation fails

**Why it matters:** Only one settings object should exist.

---

##### `test_allow_self_send_toggle`
**Purpose:** Test settings mutability  
**What it tests:**
- Create settings with self-send disabled
- Toggle to enabled
- Save and refresh
- Verify change persisted

**Why it matters:** Settings must be changeable at runtime.

---

##### `test_str_representation`
**Purpose:** Test display name  
**What it tests:**
- Settings string is "Global Settings"

**Why it matters:** Used in admin interface.

---

##### `test_timestamps`
**Purpose:** Test automatic timestamps  
**What it tests:**
- Settings has created_at
- Settings has updated_at

**Why it matters:** Track when settings were last modified.

---

## Running Tests

### Run All Tests
```bash
just test
# or
python -m pytest core/tests/ -v
```

### Run Specific Test File
```bash
just test-file core/tests/test_e2e.py
# or
python -m pytest core/tests/test_e2e.py -v
```

### Run Specific Test
```bash
just test-one core/tests/test_e2e.py::EndToEndTestCase::test_complete_message_flow
# or
python -m pytest core/tests/test_e2e.py::EndToEndTestCase::test_complete_message_flow -v
```

### Run Tests by Category
```bash
# E2E tests only
just test-e2e

# Security tests only
just test-security

# API tests only
just test-api
```

### Run with Coverage
```bash
just test-coverage
```

---

## Test Maintenance

### Adding New Tests

1. **Choose the right file:**
   - API endpoint tests → `test_api.py`
   - User workflows → `test_e2e.py`
   - Model validation → `test_models.py`
   - Security features → `test_security.py`
   - Configuration → `test_settings.py`

2. **Follow naming convention:**
   - `test_<what>_<expected_behavior>`
   - Example: `test_device_revocation_blocks_access`

3. **Include docstring:**
   - Purpose
   - What it tests
   - Why it matters

4. **Keep tests independent:**
   - Each test should run in isolation
   - Don't rely on state from other tests

### When to Add Tests

- **New feature:** Add tests before/during implementation
- **Bug fix:** Add regression test that would have caught the bug
- **Refactoring:** Add tests to verify behavior doesn't change
- **Security issue:** Add test to prevent regression

### Test Data

Tests use Django's test database which is:
- Created fresh for each test run
- Migrations applied automatically
- Destroyed after tests complete
- Isolated from development database

---

## Troubleshooting

### Tests Failing

1. **Check Django settings:**
   ```bash
   python manage.py check
   ```

2. **Run specific failing test with verbose output:**
   ```bash
   python -m pytest path/to/test -xvs
   ```

3. **Check test database:**
   ```bash
   python manage.py dbshell --settings=linkhop.settings.test
   ```

### Common Issues

- **"Database locked"** (SQLite): Tests running in parallel, use `--workers=1`
- **"Table doesn't exist"**: Migrations not applied, run `python manage.py migrate --settings=linkhop.settings.test`
- **Import errors**: Check `__init__.py` files exist in test directories

---

## See Also

- [Justfile commands](../Justfile) for test shortcuts
- [API documentation](API.md) for endpoint details
- [Security documentation](SECURITY.md) for security considerations
