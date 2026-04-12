import { test as base, type BrowserContext, type Page, chromium } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const NTFY_BINARY = resolve(import.meta.dirname!, "..", "ntfy");
const NTFY_PORT = 18091; // Different port from app e2e to avoid conflicts
export const NTFY_URL = `http://localhost:${NTFY_PORT}`;
const EXTENSION_PATH = resolve(import.meta.dirname!, "..", "extension");

let ntfyProc: ChildProcess | null = null;

function getTestConfig(port: number) {
  const configDir = resolve(tmpdir(), `ntfy-test-${port}`);
  mkdirSync(`${configDir}/cache`, { recursive: true });
  mkdirSync(`${configDir}/attachments`, { recursive: true });
  const configPath = resolve(configDir, "server.yml");
  writeFileSync(configPath, `
base-url: "http://localhost:${port}"
listen-http: ":${port}"
cache-file: "${configDir}/cache/ntfy.db"
attachment-cache-dir: "${configDir}/attachments"
no-log-dates: true
log-level: "WARN"
`.trim());
  return configPath;
}

async function ensureNtfy(): Promise<void> {
  if (ntfyProc) return;
  if (!existsSync(NTFY_BINARY)) {
    throw new Error(`ntfy binary not found at ${NTFY_BINARY}. Run: bash scripts/download-ntfy.sh`);
  }

  const configPath = getTestConfig(NTFY_PORT);
  ntfyProc = spawn(NTFY_BINARY, [
    "serve",
    "-c", configPath,
  ], { stdio: "ignore" });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${NTFY_URL}/v1/health`);
      const body = await res.json() as { healthy: boolean };
      if (body.healthy) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("ntfy failed to start");
}

/**
 * Launch a Chromium context with the extension loaded.
 * Playwright supports extensions only in Chromium via persistent context.
 */
async function launchWithExtension(): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext("", {
    headless: false, // Extensions require headed mode in Chromium
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--disable-default-apps",
    ],
  });
  return context;
}

/**
 * Get the extension's background page from the context.
 * Tries backgroundPages() first, then serviceWorkers() for newer Chromium.
 */
async function getBackgroundPage(context: BrowserContext): Promise<Page | Worker> {
  // Try background page first (classic MV2)
  let bg = context.backgroundPages()[0];
  if (bg) return bg;

  // Wait briefly for it to appear
  try {
    bg = await context.waitForEvent("backgroundpage", { timeout: 3000 });
    if (bg) return bg;
  } catch {
    // Not available as background page
  }

  // Try service workers (newer Chromium may treat MV2 bg pages this way)
  const workers = context.serviceWorkers();
  if (workers.length > 0) return workers[0];

  const worker = await context.waitForEvent("serviceworker", { timeout: 5000 });
  return worker;
}

/**
 * Set up the web app in a tab and let the content script send config to the extension.
 */
async function setupDeviceInTab(
  page: Page,
  name: string,
  password: string,
  pool = "ext-e2e-pool",
): Promise<void> {
  // Stub Notification API
  await page.addInitScript(() => {
    (window as any).Notification = {
      permission: "denied",
      requestPermission: () => Promise.resolve("denied" as NotificationPermission),
    };
  });
  await page.goto("http://localhost:5174");
  await page.waitForSelector("#setup-name");

  await page.fill("#setup-name", name);
  await page.fill("#setup-pool", pool);
  await page.fill("#setup-password", password);
  await page.fill("#setup-ntfy", NTFY_URL);
  await page.click("#setup-btn");

  await page.waitForSelector("#screen-main.active", { timeout: 10_000 });
}

/**
 * Publish a protocol event directly to ntfy (simulates a remote device sending a message).
 */
async function publishToNtfy(topic: string, event: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${NTFY_URL}/${topic}`, {
    method: "POST",
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`ntfy publish failed: ${res.status}`);
}

export const test = base.extend<{
  ntfy: void;
  extContext: BrowserContext;
  backgroundPage: Page;
}>({
  ntfy: [async ({}, use) => {
    await ensureNtfy();
    await use();
  }, { auto: true }],

  extContext: async ({}, use) => {
    const context = await launchWithExtension();
    await use(context);
    await context.close();
  },

  backgroundPage: async ({ extContext }, use) => {
    const bg = await getBackgroundPage(extContext);
    await use(bg);
  },
});

export { setupDeviceInTab, publishToNtfy, getBackgroundPage };
export { expect } from "@playwright/test";
