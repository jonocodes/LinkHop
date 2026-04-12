import { test as base, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const NTFY_BINARY = resolve(import.meta.dirname!, "..", "ntfy");
const NTFY_PORT = 18090;
export const NTFY_URL = `http://localhost:${NTFY_PORT}`;

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

/** Complete the setup form on a fresh page */
async function setupDevice(page: Page, name: string, password: string, pool = "e2e-pool"): Promise<void> {
  // Stub Notification API so requestPermission() doesn't hang in headless Firefox
  await page.addInitScript(() => {
    (window as any).Notification = {
      permission: "denied",
      requestPermission: () => Promise.resolve("denied" as NotificationPermission),
    };
  });
  await page.goto("/");
  await page.waitForSelector("#setup-name");

  await page.fill("#setup-name", name);
  await page.fill("#setup-pool", pool);
  await page.fill("#setup-password", password);
  await page.fill("#setup-ntfy", NTFY_URL);
  await page.click("#setup-btn");

  // Wait for main screen
  await page.waitForSelector("#screen-main.active", { timeout: 10_000 });
}

export const test = base.extend<{ ntfy: void }>({
  ntfy: [async ({}, use) => {
    await ensureNtfy();
    await use();
  }, { auto: true }],
});

export { setupDevice };
export { expect } from "@playwright/test";
