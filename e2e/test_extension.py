"""
Extension E2E tests.

Tests the LinkHop browser extension against a running Django server using
Playwright + Chromium (the extension's browser.* API is shimmed to chrome.*).

Run with:
    pytest e2e/test_extension.py -v -s

Or against an existing server:
    LINKHOP_TEST_SERVER=http://localhost:8000 pytest e2e/test_extension.py -v -s
"""

import json
import time
import uuid
from pathlib import Path

import pytest
import requests
from playwright.sync_api import BrowserContext

EXTENSION_PATH = Path(__file__).parent.parent / "extension"
COOKIE_NAME = "linkhop_device"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def extension_context(playwright, django_server, tmp_path_factory):
    """Persistent Chromium context with the LinkHop extension loaded."""
    user_data_dir = str(tmp_path_factory.mktemp("ext-profile"))
    ext_path = str(EXTENSION_PATH)
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        headless=False,
        args=[
            f"--load-extension={ext_path}",
            f"--disable-extensions-except={ext_path}",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--headless=new",  # new headless supports extensions
        ],
        permissions=["notifications"],
    )
    yield context
    context.close()


@pytest.fixture(scope="session")
def extension_bg(extension_context):
    """Background page of the extension (MV2 persistent background script)."""
    bg_pages = extension_context.background_pages
    if bg_pages:
        return bg_pages[0]
    return extension_context.wait_for_event("backgroundpage", timeout=10000)


@pytest.fixture(scope="session")
def extension_id(extension_bg):
    """Extract the extension ID from the background page URL."""
    # Background page URL: chrome-extension://<id>/_generated_background_page.html
    return extension_bg.url.split("://")[1].split("/")[0]


@pytest.fixture
def seed_device(extension_context, django_server):
    """
    Register a seed device via the web UI and return its token + device info.
    The seed device is used to create pairing PINs and send test messages.
    """
    page = extension_context.new_page()
    try:
        page.goto(f"{django_server}/connect")
        unique_name = f"Seed-{uuid.uuid4().hex[:6]}"
        page.fill("input[name='device_name']", unique_name)
        page.click("button[type='submit']")
        page.wait_for_url(f"{django_server}/inbox", timeout=10000)

        # Read the device token from cookie
        cookies = {c["name"]: c["value"] for c in extension_context.cookies()}
        token = cookies.get(COOKIE_NAME)
        assert token, "Device token cookie not found after enrollment"

        # Get device ID from /api/device/me
        resp = requests.get(
            f"{django_server}/api/device/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, f"Failed to get device info: {resp.text}"
        device = resp.json()

        return {"token": token, "device_id": device["id"], "name": unique_name}
    finally:
        page.close()


@pytest.fixture
def linked_extension(extension_bg, seed_device, django_server):
    """
    Register the extension as a device using a pairing PIN,
    inject credentials into the extension's storage, and start SSE.
    Returns config dict and seed device info for sending messages.
    """
    # Create a pairing PIN from the seed device
    pin_resp = requests.post(
        f"{django_server}/api/pairings/pin",
        headers={"Authorization": f"Bearer {seed_device['token']}"},
    )
    assert pin_resp.status_code == 200, f"PIN creation failed: {pin_resp.text}"
    pin = pin_resp.json()["pin"]

    # Register extension device with the PIN
    unique_name = f"Extension-{uuid.uuid4().hex[:6]}"
    reg_resp = requests.post(
        f"{django_server}/api/pairings/pin/register",
        json={"pin": pin, "device_name": unique_name},
    )
    assert reg_resp.status_code == 201, f"Extension registration failed: {reg_resp.text}"
    data = reg_resp.json()

    config = {
        "serverUrl": django_server,
        "token": data["token"],
        "deviceId": data["device"]["id"],
        "deviceName": data["device"]["name"],
        "defaultDeviceId": None,
    }

    # Clear any previous test state
    extension_bg.evaluate("""
        new Promise(r => chrome.storage.local.remove('linkhop_test_received', r))
    """)

    # Inject config into extension storage
    extension_bg.evaluate(f"""
        new Promise(r => chrome.storage.local.set({{
            linkhop_config: {json.dumps(config)}
        }}, r))
    """)

    # Start SSE connection (fire and forget — startSSE is an infinite async loop)
    extension_bg.evaluate("startSSE(); true")
    time.sleep(1.5)  # Give SSE time to connect

    return {
        "config": config,
        "seed_token": seed_device["token"],
        "seed_device_id": seed_device["device_id"],
    }


def get_test_received(bg):
    """Read the linkhop_test_received list from extension storage."""
    return bg.evaluate("""
        new Promise(r => {
            chrome.storage.local.get('linkhop_test_received', data => {
                r(data.linkhop_test_received || []);
            });
        })
    """) or []


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestExtensionPopup:
    def test_popup_shows_setup_when_unlinked(self, extension_context, extension_id, extension_bg):
        """Popup renders the setup screen when no config is stored."""
        # Clear any stored config
        extension_bg.evaluate("""
            new Promise(r => chrome.storage.local.remove('linkhop_config', r))
        """)

        popup_url = f"chrome-extension://{extension_id}/popup.html"
        popup = extension_context.new_page()
        try:
            popup.goto(popup_url)
            popup.wait_for_selector("#screen-setup:not(.hidden)", timeout=5000)
            assert popup.is_visible("#screen-setup")
            assert popup.is_hidden("#screen-main")
            assert popup.is_visible("#server-url")
            assert popup.is_visible("#pin")
        finally:
            popup.close()

    def test_popup_shows_main_when_linked(self, extension_context, extension_id, linked_extension):
        """Popup renders the main send screen when a config is already stored."""
        popup_url = f"chrome-extension://{extension_id}/popup.html"
        popup = extension_context.new_page()
        try:
            popup.goto(popup_url)
            popup.wait_for_selector("#screen-main:not(.hidden)", timeout=5000)
            assert popup.is_visible("#screen-main")
            assert popup.is_hidden("#screen-setup")
        finally:
            popup.close()


class TestExtensionSSE:
    def test_sse_hello_event_connects(self, extension_bg, linked_extension):
        """Extension background script connects to the SSE stream."""
        # After linked_extension fixture, SSE should be open
        # Check via background page evaluate — EventSource.OPEN == 1
        status = extension_bg.evaluate("""
            typeof eventSource !== 'undefined'
                ? eventSource.readyState
                : -1
        """)
        # readyState 0=CONNECTING, 1=OPEN, 2=CLOSED
        assert status in (0, 1), f"SSE readyState unexpected: {status}"

    def test_sse_delivers_message_to_extension(self, extension_bg, linked_extension, django_server):
        """
        Core SSE test: send a message to the extension device via the API,
        and verify the background script receives it via the SSE stream.
        """
        config = linked_extension["config"]
        seed_token = linked_extension["seed_token"]
        seed_device_id = linked_extension["seed_device_id"]

        test_url = f"https://example.com/sse-test-{uuid.uuid4().hex[:8]}"

        # Send message from seed device to extension device
        resp = requests.post(
            f"{django_server}/api/messages",
            headers={
                "Authorization": f"Bearer {seed_token}",
                "Content-Type": "application/json",
            },
            json={
                "recipient_device_id": config["deviceId"],
                "type": "url",
                "body": test_url,
            },
        )
        assert resp.status_code == 201, f"Send failed: {resp.text}"
        message_id = resp.json()["id"]

        # Poll extension storage for the received message ID
        deadline = time.time() + 10
        received_ids = []
        while time.time() < deadline:
            received_ids = get_test_received(extension_bg)
            if message_id in received_ids:
                break
            time.sleep(0.5)

        assert message_id in received_ids, (
            f"Message {message_id} was not received via SSE within 10s. "
            f"Got: {received_ids}"
        )

    def test_sse_delivers_multiple_messages(self, extension_bg, linked_extension, django_server):
        """Multiple messages sent in quick succession all arrive via SSE."""
        config = linked_extension["config"]
        seed_token = linked_extension["seed_token"]

        # Clear previous received IDs
        extension_bg.evaluate("""
            new Promise(r => chrome.storage.local.remove('linkhop_test_received', r))
        """)

        sent_ids = []
        for i in range(3):
            resp = requests.post(
                f"{django_server}/api/messages",
                headers={
                    "Authorization": f"Bearer {seed_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "recipient_device_id": config["deviceId"],
                    "type": "url",
                    "body": f"https://example.com/batch-{i}-{uuid.uuid4().hex[:6]}",
                },
            )
            assert resp.status_code == 201
            sent_ids.append(resp.json()["id"])
            time.sleep(0.1)

        # Wait for all 3 to arrive
        deadline = time.time() + 15
        received_ids = []
        while time.time() < deadline:
            received_ids = get_test_received(extension_bg)
            if all(mid in received_ids for mid in sent_ids):
                break
            time.sleep(0.5)

        missing = [mid for mid in sent_ids if mid not in received_ids]
        assert not missing, f"Messages not received via SSE: {missing}"

    def test_message_marked_received_on_server(self, extension_bg, linked_extension, django_server):
        """
        After SSE delivery, the extension calls /api/messages/{id}/received,
        updating the message status on the server.
        """
        config = linked_extension["config"]
        seed_token = linked_extension["seed_token"]

        resp = requests.post(
            f"{django_server}/api/messages",
            headers={
                "Authorization": f"Bearer {seed_token}",
                "Content-Type": "application/json",
            },
            json={
                "recipient_device_id": config["deviceId"],
                "type": "url",
                "body": f"https://example.com/mark-test-{uuid.uuid4().hex[:8]}",
            },
        )
        assert resp.status_code == 201
        message_id = resp.json()["id"]

        # Wait for SSE delivery
        deadline = time.time() + 10
        while time.time() < deadline:
            if message_id in get_test_received(extension_bg):
                break
            time.sleep(0.5)
        else:
            pytest.fail(f"Message {message_id} never received via SSE")

        # Give the background script time to call /received
        time.sleep(1)

        # Check message status on server
        status_resp = requests.get(
            f"{django_server}/api/messages/{message_id}",
            headers={"Authorization": f"Bearer {config['token']}"},
        )
        assert status_resp.status_code == 200
        msg = status_resp.json()
        assert msg["status"] in ("received", "presented", "opened"), (
            f"Expected message to be at least 'received', got: {msg['status']}"
        )
