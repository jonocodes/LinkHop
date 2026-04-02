"""
Mocked E2E tests for the supported MV3 extension.

These tests exercise the extension against a real Django server while mocking
the browser push APIs inside the extension service worker.
"""

from __future__ import annotations

import sqlite3
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from django.contrib.auth.hashers import make_password
from playwright.sync_api import BrowserContext, Page, Playwright, Worker, expect

from core.services.auth import hash_token


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = REPO_ROOT / "data" / "e2e-test.sqlite3"
EXTENSION_PATH = REPO_ROOT / "extension-mv3"
COOKIE_NAME = "linkhop_device"
STORAGE_KEY = "linkhop_config"


def create_account_user(username: str, password: str) -> int:
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f")
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO auth_user (
                password, last_login, is_superuser, username, last_name,
                email, is_staff, is_active, date_joined, first_name
            ) VALUES (?, NULL, 0, ?, '', '', 0, 1, ?, '')
            """,
            (make_password(password), username, now),
        )
        conn.commit()
        return int(cursor.lastrowid)


def create_owned_device(owner_id: int, name: str) -> tuple[str, str]:
    device_id = uuid.uuid4().hex
    raw_token = f"device_{uuid.uuid4().hex}"
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f")
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO core_device (
                created_at, updated_at, id, name, token_hash, is_active, revoked_at,
                last_seen_at, owner_id, browser, device_type, last_push_at, os
            ) VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?, '', '', NULL, '')
            """,
            (now, now, device_id, name, hash_token(raw_token), owner_id),
        )
        conn.commit()
    return str(uuid.UUID(device_id)), raw_token


def push_subscription_row(endpoint: str) -> tuple[int, str] | None:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            """
            SELECT COUNT(*), MAX(client_type)
            FROM core_pushsubscription
            WHERE endpoint = ?
            """,
            (endpoint,),
        ).fetchone()
    if row is None or row[0] == 0:
        return None
    return int(row[0]), str(row[1] or "")


@pytest.fixture
def extension_context(playwright: Playwright, tmp_path) -> BrowserContext:
    context = playwright.chromium.launch_persistent_context(
        str(tmp_path / "mv3-profile"),
        headless=False,
        args=[
            f"--disable-extensions-except={EXTENSION_PATH}",
            f"--load-extension={EXTENSION_PATH}",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--headless=new",
        ],
        permissions=["notifications"],
    )
    yield context
    context.close()


@pytest.fixture
def extension_service_worker(extension_context: BrowserContext) -> Worker:
    workers = extension_context.service_workers
    if workers:
        return workers[0]
    return extension_context.wait_for_event("serviceworker", timeout=10000)


@pytest.fixture
def extension_id(extension_service_worker: Worker) -> str:
    return extension_service_worker.url.split("://", 1)[1].split("/", 1)[0]


def link_shared_browser_device(
    page: Page,
    django_server: str,
    extension_context: BrowserContext,
    username: str,
    password: str,
    device_name: str = "Browser Device",
) -> str:
    page.goto(f"{django_server}/account/login/")
    page.locator("input[name='username']").fill(username)
    page.locator("input[name='password']").fill(password)
    page.locator("input[type='submit']").click()
    expect(page).to_have_url(f"{django_server}/account/connected-devices/")

    page.goto(f"{django_server}/account/activate-device/")
    page.locator("input[name='device_name']").fill(device_name)
    page.locator("form[action='/account/activate-device/'] button[type='submit']").click()
    expect(page).to_have_url(f"{django_server}/account/inbox/")

    page.locator("#btn-ext").click()
    time.sleep(0.5)

    cookies = extension_context.cookies()
    return next(cookie["value"] for cookie in cookies if cookie["name"] == COOKIE_NAME)


class TestExtensionMV3Mock:
    def test_popup_shows_setup_when_unlinked(
        self,
        extension_context: BrowserContext,
        extension_id: str,
    ) -> None:
        popup = extension_context.new_page()
        try:
            popup.goto(f"chrome-extension://{extension_id}/popup.html")
            popup.wait_for_selector("#screen-setup:not(.hidden)", timeout=5000)
            assert popup.is_visible("#screen-setup")
            assert popup.is_hidden("#screen-main")
        finally:
            popup.close()

    def test_inbox_link_shares_browser_device_token_with_extension(
        self,
        extension_context: BrowserContext,
        extension_service_worker: Worker,
        extension_id: str,
        django_server: str,
    ) -> None:
        username = f"ext-link-{uuid.uuid4().hex[:8]}"
        password = f"pass-{uuid.uuid4().hex}"
        create_account_user(username, password)

        page = extension_context.new_page()
        popup = extension_context.new_page()
        try:
            browser_token = link_shared_browser_device(
                page,
                django_server,
                extension_context,
                username,
                password,
            )

            config = extension_service_worker.evaluate(
                """
                (storageKey) => new Promise((resolve) => {
                  chrome.storage.local.get(storageKey, (result) => resolve(result[storageKey] || null));
                })
                """,
                STORAGE_KEY,
            )

            assert config is not None
            assert config["token"] == browser_token

            popup.goto(f"chrome-extension://{extension_id}/popup.html")
            popup.wait_for_selector("#screen-main:not(.hidden)", timeout=5000)
            assert popup.is_visible("#screen-main")
            assert popup.is_hidden("#screen-setup")
        finally:
            popup.close()
            page.close()

    def test_popup_can_send_to_another_owned_device(
        self,
        extension_context: BrowserContext,
        extension_id: str,
        django_server: str,
    ) -> None:
        username = f"ext-send-{uuid.uuid4().hex[:8]}"
        password = f"pass-{uuid.uuid4().hex}"
        owner_id = create_account_user(username, password)
        recipient_id, _ = create_owned_device(owner_id, "Phone")

        page = extension_context.new_page()
        popup = extension_context.new_page()
        try:
            link_shared_browser_device(
                page,
                django_server,
                extension_context,
                username,
                password,
            )

            popup.goto(f"chrome-extension://{extension_id}/popup.html")
            popup.wait_for_selector("#screen-main:not(.hidden)", timeout=5000)
            popup.locator("#device-select").select_option(recipient_id)
            popup.locator("#send-body").fill("https://example.com/from-extension")
            popup.locator("#btn-send").click()
            expect(popup.locator("#send-feedback")).to_have_text("Sent!")
        finally:
            popup.close()
            page.close()

    def test_service_worker_registers_mocked_extension_push_subscription(
        self,
        extension_context: BrowserContext,
        extension_service_worker: Worker,
        extension_id: str,
        django_server: str,
    ) -> None:
        username = f"ext-push-{uuid.uuid4().hex[:8]}"
        password = f"pass-{uuid.uuid4().hex}"
        endpoint = f"https://push.example.test/extension/{uuid.uuid4().hex}"
        create_account_user(username, password)

        page = extension_context.new_page()
        popup = extension_context.new_page()
        try:
            link_shared_browser_device(
                page,
                django_server,
                extension_context,
                username,
                password,
            )

            extension_service_worker.evaluate(
                """
                (endpoint) => {
                  const fakeSubscription = {
                    endpoint,
                    toJSON() {
                      return {
                        endpoint: this.endpoint,
                        keys: {
                          p256dh: "extension-p256dh",
                          auth: "extension-auth"
                        }
                      };
                    },
                    unsubscribe() {
                      return Promise.resolve(true);
                    }
                  };
                  Object.defineProperty(self.registration, "pushManager", {
                    configurable: true,
                    value: {
                      getSubscription() {
                        return Promise.resolve(null);
                      },
                      subscribe() {
                        return Promise.resolve(fakeSubscription);
                      }
                    }
                  });
                }
                """,
                endpoint,
            )

            popup.goto(f"chrome-extension://{extension_id}/popup.html")
            popup.wait_for_selector("#screen-main:not(.hidden)", timeout=5000)
            reply = popup.evaluate(
                """
                () => chrome.runtime.sendMessage({ type: "register_push" })
                """
            )

            assert reply["ok"] is True
            row = push_subscription_row(endpoint)
            assert row is not None
            assert row[0] == 1
            assert row[1] == "extension"
        finally:
            popup.close()
            page.close()
