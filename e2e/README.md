# LinkHop E2E Browser Tests

Browser-based tests using Playwright to verify real-time functionality.

## Setup

The tests are configured to work with your existing Playwright setup from `../savr`.

## Running Tests

### Using pytest (from LinkHop directory):

```bash
# Run all E2E tests
pytest e2e/ -v

# Run specific test
pytest e2e/test_sse_realtime.py -v

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
- `test_sse_realtime.py` - Tests for SSE real-time message delivery
  - Device enrollment through browser
  - Real-time message delivery
  - Message status updates
  - Multiple message ordering

## How It Works

1. **Django Server Fixture**: Automatically starts `manage.py runserver` on port 8000
2. **Browser Contexts**: Creates isolated browser contexts for each device
3. **Device Enrollment**: Uses the web UI to enroll devices (simulates real user)
4. **SSE Connection**: The inbox page automatically establishes SSE connection
5. **Message Sending**: Uses the send form to send messages
6. **Real-time Verification**: Checks that messages appear without page refresh

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
