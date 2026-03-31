"""
Browser-based E2E tests for PWA push enrollment.

These tests mock the browser push APIs while still exercising the LinkHop
web UI and backend subscription persistence.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import Browser, BrowserContext, Page, expect


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = REPO_ROOT / "data" / "e2e-test.sqlite3"


def create_enrollment_token() -> str:
    result = subprocess.run(
        [
            sys.executable,
            "manage.py",
            "shell",
            "-c",
            (
                "from core.services.auth import create_enrollment_token; "
                "print(create_enrollment_token(label='PWA Push E2E')[1])"
            ),
        ],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip().splitlines()[-1]


def register_device_via_api(server_url: str, device_name: str) -> str:
    payload = json.dumps(
        {
            "enrollment_token": create_enrollment_token(),
            "device_name": device_name,
            "platform_label": "test",
            "app_version": "1.0",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{server_url}/api/devices/register",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = json.loads(response.read().decode("utf-8"))
    return body["token"]


def subscription_row(endpoint: str) -> tuple[int, int] | None:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT COUNT(*), MAX(is_active) FROM core_pushsubscription WHERE endpoint = ?",
            (endpoint,),
        ).fetchone()
    if row is None or row[0] == 0:
        return None
    return int(row[0]), int(row[1] or 0)


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

        page.add_init_script(
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
              const originalMatchMedia = window.matchMedia
                ? window.matchMedia.bind(window)
                : null;
              window.matchMedia = function (query) {
                if (query === "(display-mode: standalone)") {
                  return { ...fallbackMedia, matches: true, media: query };
                }
                return originalMatchMedia ? originalMatchMedia(query) : fallbackMedia;
              };
            }
            """,
            endpoint,
        )

        device_token = register_device_via_api(django_server, "PWA Push Device")

        page.goto(f"{django_server}/connect")
        page.locator("input[name='token']").fill(device_token)
        page.locator("form[action='/connect'] button[type='submit']").click()
        expect(page).to_have_url(f"{django_server}/inbox")

        expect(page.locator("#push-bar")).to_be_visible()
        expect(page.locator("#push-btn")).to_have_text("Enable Push")

        page.locator("#push-btn").click()
        expect(page.locator("#push-status")).to_have_text("Push enabled.")
        expect(page.locator("#push-disable")).to_be_visible()

        row = subscription_row(endpoint)
        assert row is not None
        assert row[0] == 1
        assert row[1] == 1

        page.locator("#push-disable").click()
        expect(page.locator("#push-status")).to_have_text("Push disabled.")
        expect(page.locator("#push-btn")).to_have_text("Enable Push")

        row = subscription_row(endpoint)
        assert row is not None
        assert row[0] == 1
        assert row[1] == 0

        page.close()
        pwa_context.close()
