"""
Browser-based E2E tests for PWA push enrollment.

These tests mock the browser push APIs while still exercising the LinkHop
web UI and backend subscription persistence.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from datetime import datetime, UTC
from pathlib import Path

import pytest
from django.contrib.auth.hashers import make_password
from playwright.sync_api import Browser, BrowserContext, Page, expect


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = REPO_ROOT / "data" / "e2e-test.sqlite3"
COOKIE_NAME = "linkhop_device"


def subscription_row(endpoint: str) -> tuple[int, int] | None:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT COUNT(*), MAX(is_active) FROM core_pushsubscription WHERE endpoint = ?",
            (endpoint,),
        ).fetchone()
    if row is None or row[0] == 0:
        return None
    return int(row[0]), int(row[1] or 0)


def create_account_user(username: str, password: str, *, is_superuser: bool = False) -> None:
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f")
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO auth_user (
                password, last_login, is_superuser, username, last_name,
                email, is_staff, is_active, date_joined, first_name
            ) VALUES (?, NULL, ?, ?, '', '', ?, 1, ?, '')
            """,
            (
                make_password(password),
                1 if is_superuser else 0,
                username,
                1 if is_superuser else 0,
                now,
            ),
        )
        conn.commit()


@pytest.fixture
def pwa_context(browser: Browser) -> BrowserContext:
    context = browser.new_context(
        viewport={"width": 1280, "height": 720},
    )
    return context


class TestPWAPushEnrollment:
    def test_inbox_can_enable_and_disable_push_subscription(
        self,
        pwa_context: BrowserContext,
        django_server: str,
    ) -> None:
        page = pwa_context.new_page()
        page.set_default_timeout(10000)
        endpoint = f"https://push.example.test/sub/{int(time.time() * 1000)}"

        username = f"push-e2e-{uuid.uuid4().hex[:8]}"
        password = f"pass-{uuid.uuid4().hex}"
        device_name = "PWA Push Device"
        create_account_user(username, password)

        page.goto(f"{django_server}/account/login/")
        page.locator("input[name='username']").fill(username)
        page.locator("input[name='password']").fill(password)
        page.locator("input[type='submit']").click()
        expect(page).to_have_url(f"{django_server}/account/connected-devices/")

        page.goto(f"{django_server}/account/activate-device/")
        page.locator("input[name='device_name']").fill(device_name)
        page.locator("form[action='/account/activate-device/'] button[type='submit']").click()
        expect(page).to_have_url(f"{django_server}/account/inbox/")

        token = next(
            cookie["value"]
            for cookie in pwa_context.cookies()
            if cookie["name"] == COOKIE_NAME
        )

        page.evaluate(
            """
            (endpoint) => {
              let currentSubscription = null;
              const fakeSubscription = {
                endpoint,
                toJSON() {
                  return {
                    endpoint: this.endpoint,
                    keys: {
                      p256dh: "test-p256dh",
                      auth: "test-auth"
                    }
                  };
                },
                unsubscribe() {
                  currentSubscription = null;
                  return Promise.resolve(true);
                }
              };

              const fakeRegistration = {
                active: {
                  postMessage() {}
                },
                pushManager: {
                  getSubscription() {
                    return Promise.resolve(currentSubscription);
                  },
                  subscribe() {
                    currentSubscription = fakeSubscription;
                    return Promise.resolve(fakeSubscription);
                  }
                }
              };

              Object.defineProperty(window, "Notification", {
                configurable: true,
                value: class Notification {
                  static permission = "granted";
                  static requestPermission() {
                    return Promise.resolve("granted");
                  }
                  constructor() {}
                  close() {}
                }
              });
              Object.defineProperty(window, "PushManager", {
                configurable: true,
                value: class PushManager {}
              });

              const sw = navigator.serviceWorker || {};
              sw.register = () => Promise.resolve(fakeRegistration);
              Object.defineProperty(sw, "ready", {
                configurable: true,
                get() {
                  return Promise.resolve(fakeRegistration);
                }
              });
              if (!sw.controller) {
                sw.controller = { postMessage() {} };
              }
              if (!sw.addEventListener) {
                sw.addEventListener = function () {};
              }
              Object.defineProperty(navigator, "serviceWorker", {
                configurable: true,
                value: sw
              });

              const fallbackMedia = {
                matches: false,
                media: "",
                onchange: null,
                addListener() {},
                removeListener() {},
                addEventListener() {},
                removeEventListener() {},
                dispatchEvent() { return false; }
              };
              window.matchMedia = function (query) {
                if (query === "(display-mode: standalone)") {
                  return { ...fallbackMedia, matches: true, media: query };
                }
                return fallbackMedia;
              };
            }
            """,
            endpoint,
        )

        enable_result = page.evaluate(
            """
            (token) => new Promise((resolve) => {
              LinkHopPush.enable(token, (ok, message) => resolve({ ok, message }));
            })
            """,
            token,
        )
        assert enable_result["ok"], enable_result.get("message")

        row = subscription_row(endpoint)
        assert row is not None
        assert row[0] == 1
        assert row[1] == 1

        disable_result = page.evaluate(
            """
            (token) => new Promise((resolve) => {
              LinkHopPush.disable(token, (ok) => resolve({ ok }));
            })
            """,
            token,
        )
        assert disable_result["ok"]

        row = subscription_row(endpoint)
        assert row is not None
        assert row[0] == 1
        assert row[1] == 0

        page.close()
        pwa_context.close()
