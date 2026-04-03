/**
 * Full-stack browser test: login → device → service worker → Test Push → inbox text.
 * Run from repo: cd linkhop-ts/playwright && npm i && npx playwright install chromium && npm test
 * Requires `deno` on PATH to start linkhop-ts.
 */
import { test, expect } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSync } from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LINKHOP_TS_ROOT = join(__dirname, '..');

const VAPID_PUBLIC =
  'BBvpFoiYt65QJjzdcssh4bqdAMVSd8TO7vv-7cdz9Bj7PQts0v2uGX_XN5MWQIo2Bg131oL-OJDrPIXQeF2aGGI';
const VAPID_PRIVATE = 'PQts0v2uGX_XN5MWQIo2Bg131oL-OJDrPIXQeF2aGGI';
const PORT = 8011;
const BASE = `http://127.0.0.1:${PORT}`;

const hasDeno = spawnSync('deno', ['--version'], { stdio: 'ignore' }).status === 0;
test.skip(!hasDeno, 'deno must be on PATH to start linkhop-ts');

function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = createConnection({ host, port }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`timeout waiting for ${host}:${port}`));
        } else {
          setTimeout(tryConnect, 200);
        }
      });
    };
    tryConnect();
  });
}

let serverProc: ChildProcess | undefined;
let tmpDir: string | undefined;

test.beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'linkhop-playwright-'));
  const dbPath = join(tmpDir, 'e2e.db');
  const passwordHash = hashSync('testpass123', 12);

  serverProc = spawn('deno', ['run', '-A', 'src/main.ts'], {
    cwd: LINKHOP_TS_ROOT,
    env: {
      ...process.env,
      PASSWORD_HASH: passwordHash,
      VAPID_PUBLIC_KEY: VAPID_PUBLIC,
      VAPID_PRIVATE_KEY: VAPID_PRIVATE,
      VAPID_SUBJECT: 'mailto:test@localhost',
      DB_PATH: dbPath,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      SESSION_SECRET: 'linkhop-ts-playwright-session',
      ALLOW_SELF_SEND: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForPort('127.0.0.1', PORT, 30_000);
  } catch (e) {
    const err = serverProc.stderr?.read?.() ?? '';
    serverProc.kill('SIGTERM');
    throw new Error(`${e}\n${err}`);
  }
});

test.afterAll(() => {
  if (serverProc?.pid) {
    try {
      serverProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test('Test Push shows echoed message in inbox', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ['notifications'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  await page.goto(`${BASE}/login`);
  await page.locator("input[name='password']").fill('testpass123');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(`${BASE}/account/activate-device`, { timeout: 15_000 });

  const deviceName = `pw-${randomUUID().slice(0, 8)}`;
  await page.locator("input[name='name']").fill(deviceName);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(`${BASE}/account/inbox`, { timeout: 15_000 });

  await page.waitForFunction(
    () => navigator.serviceWorker && !!navigator.serviceWorker.controller,
    null,
    { timeout: 30_000 },
  );

  const subscribed = await page.evaluate(async () => {
    const link = await fetch('/api/session/link', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!link.ok) return false;
    const { token } = await link.json();
    const r = await fetch('/api/push/subscriptions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        endpoint: 'https://push.invalid.example/e2e-browser',
        keys: { p256dh: 'e2e-p256dh', auth: 'e2e-auth' },
        client_type: 'browser',
      }),
    });
    return r.status === 204;
  });
  expect(subscribed).toBe(true);

  await page.locator('#push-test').click();
  await expect(page.locator('#push-status')).toContainText('Test push sent', {
    timeout: 15_000,
  });
  await expect(page.locator('#message-list')).toContainText('LinkHop push test', {
    timeout: 15_000,
  });

  await context.close();
});
