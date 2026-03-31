"""
Playwright configuration for LinkHop E2E browser tests.
"""

import pytest
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext
from typing import Generator
import subprocess
import time
import socket
import os
import sys


def wait_for_server(host: str, port: int, timeout: float = 30.0) -> bool:
    """Wait for server to become available."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except (socket.timeout, ConnectionRefusedError):
            time.sleep(0.5)
    return False


@pytest.fixture(scope="session")
def django_server() -> Generator[str, None, None]:
    """Start Django development server for testing."""

    # Use existing server if LINKHOP_TEST_SERVER is set
    if os.environ.get("LINKHOP_TEST_SERVER"):
        yield os.environ["LINKHOP_TEST_SERVER"]
        return

    print("\n🚀 Starting Django development server...")

    # Start the server
    env = os.environ.copy()
    env["DJANGO_SETTINGS_MODULE"] = "linkhop.settings.e2e"
    env.setdefault("LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY", "test-public-key")
    env.setdefault("LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY", "test-private-key")
    env.setdefault("LINKHOP_WEBPUSH_VAPID_SUBJECT", "mailto:test@example.com")
    process = subprocess.Popen(
        [sys.executable, "manage.py", "runserver", "127.0.0.1:8000", "--noreload"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )

    # Wait for server to start
    if not wait_for_server("127.0.0.1", 8000, timeout=30):
        process.terminate()
        raise RuntimeError("Django server failed to start")

    print("✅ Django server ready on http://127.0.0.1:8000\n")

    yield "http://127.0.0.1:8000"

    # Cleanup
    print("\n🛑 Stopping Django server...")
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
    print("✅ Server stopped\n")


@pytest.fixture(scope="session")
def playwright() -> Generator:
    """Start Playwright."""
    with sync_playwright() as p:
        yield p


@pytest.fixture(scope="session")
def browser(playwright) -> Generator[Browser, None, None]:
    """Launch browser."""
    browser = playwright.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
        ],
    )
    yield browser
    browser.close()


@pytest.fixture
def context(browser: Browser) -> Generator[BrowserContext, None, None]:
    """Create browser context."""
    context = browser.new_context(
        viewport={"width": 1280, "height": 720},
    )
    yield context
    context.close()


@pytest.fixture
def page(context: BrowserContext, django_server: str) -> Generator[Page, None, None]:
    """Create page with base URL."""
    page = context.new_page()
    page.set_default_timeout(10000)
    page.set_default_navigation_timeout(10000)
    yield page
    page.close()
