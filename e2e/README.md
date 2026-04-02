# LinkHop E2E Browser Tests

Browser-based tests using Playwright to verify the maintained web flows.

## Setup

The tests are configured to work with your existing Playwright setup from `../savr`.

## Running Tests

### Using pytest (from LinkHop directory):

```bash
# Run maintained browser E2E tests
pytest e2e/ -v

# Run push enrollment browser test
pytest e2e/test_pwa_push.py -v

# Run MV3 extension browser tests
pytest e2e/test_extension_mv3.py -v -s

# Run with headed browser (visible)
pytest e2e/ -v --headed

# Run in debug mode
pytest e2e/ -v --debug
```

### Using Just commands:

```bash
# Run E2E tests
just test-e2e-browser

# Run with UI mode
just test-e2e-ui
```

### Using existing server:

If you already have a Django server running:

```bash
export LINKHOP_TEST_SERVER=http://localhost:8000
pytest e2e/ -v
```

## Test Structure

- `conftest.py` - Playwright fixtures and Django server setup
- `test_pwa_push.py` - Installed-PWA push enrollment and unsubscribe flow
- `test_extension_mv3.py` - Mocked MV3 extension tests for shared-device linking, sending, and push registration

## How It Works

1. **Django Server Fixture**: Automatically starts `manage.py runserver` on port 8000
2. **Browser Contexts**: Creates isolated browser contexts for each test run
3. **Account + Device Flow**: Browser tests use the current account and `/account/...` device flow
4. **Push Mocking**: `test_pwa_push.py` mocks browser push APIs while persisting real subscriptions server-side
5. **Extension Mocking**: `test_extension_mv3.py` loads the MV3 extension in Chromium and mocks push APIs inside the extension service worker

## Push E2E Notes

`test_pwa_push.py` does not require a real browser push service. It:

1. Creates a real device token through the LinkHop API
2. Connects through the current account/device flow
3. Mocks `Notification`, `serviceWorker`, and `PushManager`
4. Verifies `/api/push/subscriptions` persists and deactivates the subscription row

The Django server fixture sets test VAPID env vars automatically if they are not already present, so `GET /api/push/config` stays enabled during browser runs.

## Troubleshooting

### Playwright not found

Make sure Playwright browsers are installed:
```bash
playwright install chromium
```

### Server won't start

Check if port 8000 is already in use:
```bash
lsof -i :8000
```

Or use an existing server:
```bash
export LINKHOP_TEST_SERVER=http://localhost:8000
pytest e2e/ -v
```

### Tests timeout

The tests use 10-second timeouts by default. If your system is slow, you can increase:

```python
# In conftest.py
page.set_default_timeout(20000)  # 20 seconds
```
