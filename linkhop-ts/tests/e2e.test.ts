import { assertEquals, assertNotEquals } from 'jsr:@std/assert';
import { join } from '@std/path';
import { hash } from 'bcryptjs';
import { createApp } from '../src/app.ts';
import { applyRuntimeConfig } from '../src/config.ts';
import { stringify } from '@std/dotenv';

const PROJECT_ROOT = join(import.meta.url.replace('file://', ''), '..', '..');
const ENV_PATH = join(PROJECT_ROOT, '.env');
const ENV_BACKUP_PATH = join(PROJECT_ROOT, '.env.test-backup');

const TEST_PASSWORD = 'testpass123';
const SESSION_COOKIE = 'linkhop_session';
const DEVICE_COOKIE = 'linkhop_device';

let app: Awaited<ReturnType<typeof createApp>>;
let testDbPath: string;
let savedEnv: string | null;

async function globalSetup() {
  try {
    savedEnv = await Deno.readTextFile(ENV_PATH);
    await Deno.rename(ENV_PATH, ENV_BACKUP_PATH);
  } catch {
    savedEnv = null;
  }

  const tmpDir = await Deno.makeTempDir({ prefix: 'linkhop_e2e_' });
  testDbPath = join(tmpDir, 'test.db');

  const passwordHash = await hash(TEST_PASSWORD, 12);

  const testEnv = {
    PASSWORD_HASH: passwordHash,
    SESSION_SECRET: 'e2e-test-secret-key-12345',
    VAPID_PUBLIC_KEY: 'BBvpFoiYt65QJjzdcssh4bqdAMVSd8TO7vv-7cdz9Bj7PQts0v2uGX_XN5MWQIo2Bg131oL-OJDrPIXQeF2aGGI',
    VAPID_PRIVATE_KEY: 'PQts0v2uGX_XN5MWQIo2Bg131oL-OJDrPIXQeF2aGGI',
    VAPID_SUBJECT: 'mailto:test@localhost',
    DB_PATH: testDbPath,
    PORT: '8001',
    HOST: '127.0.0.1',
    ALLOW_SELF_SEND: 'true',
  };

  await Deno.writeTextFile(ENV_PATH, `${stringify(testEnv)}\n`);
  applyRuntimeConfig(testEnv);

  app = await createApp();
}

async function globalTeardown() {
  const dir = testDbPath ? join(testDbPath, '..') : null;
  if (dir) {
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // ignore
    }
  }

  try {
    await Deno.rename(ENV_BACKUP_PATH, ENV_PATH);
  } catch {
    // no backup to restore
  }
}

function extractCookie(headers: Headers, name: string): string | null {
  const setCookie = headers.get('set-cookie') || '';
  const all = setCookie.split(',').flatMap((s: string) => s.trim().split(';'));
  for (const part of all) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

async function login(): Promise<string> {
  const res = await app.request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `password=${TEST_PASSWORD}`,
    redirect: 'manual',
  });
  const cookie = extractCookie(res.headers, SESSION_COOKIE);
  if (!cookie) throw new Error('Login failed: no session cookie');
  return cookie;
}

async function registerDevice(
  sessionCookie: string,
  name: string,
): Promise<string> {
  const res = await app.request('/account/activate-device', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `${SESSION_COOKIE}=${sessionCookie}`,
    },
    body: `name=${encodeURIComponent(name)}`,
    redirect: 'manual',
  });
  const token = extractCookie(res.headers, DEVICE_COOKIE);
  if (!token) throw new Error(`Device registration failed for ${name}`);
  return token;
}

Deno.test({
  name: 'e2e suite',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    await globalSetup();

    await t.step('GET /healthz returns ok', async () => {
      const res = await app.request('/healthz');
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { ok: true });
    });

    await t.step('GET / redirects to /login without session', async () => {
      const res = await app.request('/', { redirect: 'manual' });
      assertEquals(res.status, 302);
      assertEquals(res.headers.get('location'), '/login');
    });

    await t.step('GET /login renders login form', async () => {
      const res = await app.request('/login');
      assertEquals(res.status, 200);
      const html = await res.text();
      assertNotEquals(html.indexOf('Sign in'), -1);
      assertNotEquals(html.indexOf('password'), -1);
    });

    await t.step('POST /login rejects wrong password', async () => {
      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=wrongpassword1',
      });
      assertEquals(res.status, 401);
      const html = await res.text();
      assertNotEquals(html.indexOf('Invalid password'), -1);
    });

    await t.step('POST /login succeeds with correct password', async () => {
      const res = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `password=${TEST_PASSWORD}`,
        redirect: 'manual',
      });
      assertEquals(res.status, 302);
      assertEquals(res.headers.get('location'), '/account/inbox');
      assertNotEquals(extractCookie(res.headers, SESSION_COOKIE), null);
    });

    let session: string;
    let deviceToken: string;

    await t.step('GET / redirects to /account/inbox with session', async () => {
      session = await login();
      const res = await app.request('/', {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        redirect: 'manual',
      });
      assertEquals(res.status, 302);
      assertEquals(res.headers.get('location'), '/account/inbox');
    });

    await t.step('protected pages redirect without session', async () => {
      for (const path of ['/account/inbox', '/account/send', '/account/devices', '/account/settings']) {
        const res = await app.request(path, { redirect: 'manual' });
        assertEquals(res.status, 302);
        assertEquals(res.headers.get('location'), '/login');
      }
    });

    await t.step('GET /api/me requires session', async () => {
      const res = await app.request('/api/me');
      assertEquals(res.status, 401);
    });

    await t.step('GET /api/me returns authenticated with session', async () => {
      const res = await app.request('/api/me', {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
      });
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { authenticated: true });
    });

    await t.step('GET /account/activate-device renders form', async () => {
      const res = await app.request('/account/activate-device', {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
      });
      assertEquals(res.status, 200);
      const html = await res.text();
      assertNotEquals(html.indexOf('Activate this browser'), -1);
    });

    await t.step('POST /account/activate-device registers device', async () => {
      deviceToken = await registerDevice(session, 'TestLaptop');
      assertNotEquals(deviceToken, '');
      assertNotEquals(deviceToken.indexOf('device_'), -1);
    });

    await t.step('GET /account/inbox serves SPA shell with session', async () => {
      const res = await app.request('/account/inbox', {
        headers: {
          Cookie: `${SESSION_COOKIE}=${session}`,
        },
      });
      assertEquals(res.status, 200);
      const html = await res.text();
      // SPA shell should have the app.html content
      assertNotEquals(html.indexOf('page-heading'), -1);
      assertNotEquals(html.indexOf('main-nav'), -1);
    });

    await t.step('GET /account/send serves SPA shell', async () => {
      const res = await app.request('/account/send', {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
      });
      assertEquals(res.status, 200);
      const html = await res.text();
      assertNotEquals(html.indexOf('app-content'), -1);
    });

    await t.step('GET /account/devices serves SPA shell', async () => {
      const res = await app.request('/account/devices', {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
      });
      assertEquals(res.status, 200);
      const html = await res.text();
      assertNotEquals(html.indexOf('app-content'), -1);
    });

    await t.step('GET /account/settings serves SPA shell', async () => {
      const res = await app.request('/account/settings', {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
      });
      assertEquals(res.status, 200);
      const html = await res.text();
      assertNotEquals(html.indexOf('app-content'), -1);
    });

    await t.step('GET /api/push/config returns VAPID key', async () => {
      const res = await app.request('/api/push/config');
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.supported, true);
      assertEquals(typeof body.vapid_public_key, 'string');
      assertEquals(body.vapid_public_key.length > 0, true);
    });

    await t.step('API /api/devices requires device token', async () => {
      const res = await app.request('/api/devices');
      assertEquals(res.status, 401);
      assertEquals((await res.json()).error, 'device authentication required');
    });

    await t.step('API /api/device/me returns current device', async () => {
      const res = await app.request('/api/device/me', {
        headers: { Authorization: `Bearer ${deviceToken}` },
      });
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.name, 'TestLaptop');
      assertEquals(body.is_active, 1);
      assertEquals(body.device_type, 'browser');
    });

    await t.step('API /api/devices lists devices', async () => {
      const res = await app.request('/api/devices', {
        headers: { Authorization: `Bearer ${deviceToken}` },
      });
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.devices.length, 1);
      assertEquals(body.devices[0].name, 'TestLaptop');
      assertEquals(body.allow_self_send, true);
    });

    await t.step('API /api/messages rejects invalid payload', async () => {
      const res = await app.request('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({}),
      });
      assertEquals(res.status, 400);
    });

    await t.step('API /api/messages rejects unknown recipient', async () => {
      const res = await app.request('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({
          recipient_device_id: crypto.randomUUID(),
          type: 'text',
          body: 'hello',
        }),
      });
      assertEquals(res.status, 404);
    });

    let deviceToken2: string;

    await t.step('register second device', async () => {
      deviceToken2 = await registerDevice(session, 'TestPhone');
    });

    await t.step('send message between two devices (no subscriptions)', async () => {
      const devicesRes = await app.request('/api/devices', {
        headers: { Authorization: `Bearer ${deviceToken}` },
      });
      const devicesList = (await devicesRes.json()).devices;
      const phoneId = devicesList.find((d: { name: string }) => d.name === 'TestPhone').id;

      const msgRes = await app.request('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({
          recipient_device_id: phoneId,
          type: 'url',
          body: 'https://example.com/e2e-test',
        }),
      });

      assertEquals(msgRes.status, 201);
      const msgBody = await msgRes.json();
      assertEquals(msgBody.type, 'url');
      assertEquals(msgBody.body, 'https://example.com/e2e-test');
      assertEquals(msgBody.recipient_device_id, phoneId);
      assertEquals(msgBody.push_subscriptions, 0);
      assertEquals(msgBody.push_delivered, false);
    });

    await t.step('send message exercises push delivery path', async () => {
      const devicesRes = await app.request('/api/devices', {
        headers: { Authorization: `Bearer ${deviceToken2}` },
      });
      const devicesList = (await devicesRes.json()).devices;
      const laptopId = devicesList.find((d: { name: string }) => d.name === 'TestLaptop').id;
      const phoneId = devicesList.find((d: { name: string }) => d.name === 'TestPhone').id;

      const subRes = await app.request('/api/push/subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken2}`,
        },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/sub/e2e-recipient',
          keys: { p256dh: 'fake-p256dh-key-for-testing', auth: 'fake-auth-key' },
          client_type: 'browser',
        }),
      });
      assertEquals(subRes.status, 204);

      const msgRes = await app.request('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({
          recipient_device_id: phoneId,
          type: 'text',
          body: 'push delivery test',
        }),
      });

      assertEquals(msgRes.status, 201);
      const msgBody = await msgRes.json();
      assertEquals(msgBody.push_subscriptions, 1);
    });

    await t.step('self-send succeeds (ALLOW_SELF_SEND=true)', async () => {
      const devicesRes = await app.request('/api/devices', {
        headers: { Authorization: `Bearer ${deviceToken}` },
      });
      const laptopId = (await devicesRes.json()).devices.find(
        (d: { name: string }) => d.name === 'TestLaptop',
      ).id;

      const msgRes = await app.request('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({
          recipient_device_id: laptopId,
          type: 'text',
          body: 'self message',
        }),
      });
      assertEquals(msgRes.status, 201);
      const msgBody = await msgRes.json();
      assertEquals(msgBody.body, 'self message');
      assertEquals(msgBody.sender_device_id, laptopId);
      assertEquals(msgBody.recipient_device_id, laptopId);
    });

    await t.step('API /api/push/subscriptions upsert', async () => {
      const res = await app.request('/api/push/subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/sub/123',
          keys: { p256dh: 'fake-key', auth: 'fake-auth' },
          client_type: 'pwa',
        }),
      });
      assertEquals(res.status, 204);
    });

    await t.step('API /api/push/subscriptions delete', async () => {
      const res = await app.request('/api/push/subscriptions', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({ endpoint: 'https://push.example.com/sub/123' }),
      });
      assertEquals(res.status, 204);
    });

    await t.step('API /api/session/link returns device info', async () => {
      const res = await app.request('/api/session/link', {
        method: 'POST',
        headers: {
          Cookie: `${SESSION_COOKIE}=${session}; ${DEVICE_COOKIE}=${deviceToken}`,
        },
      });
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.device.name, 'TestLaptop');
      assertEquals(typeof body.token, 'string');
    });

    await t.step('GET /hop redirects to /account/send with session', async () => {
      const res = await app.request('/hop', {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        redirect: 'manual',
      });
      assertEquals(res.status, 302);
      assertEquals(res.headers.get('location'), '/account/send');
    });

    await t.step('GET /share redirects to /account/send with session', async () => {
      const res = await app.request('/share', {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        redirect: 'manual',
      });
      assertEquals(res.status, 302);
      assertEquals(res.headers.get('location'), '/account/send');
    });

    await t.step('GET /logout clears session and redirects', async () => {
      const res = await app.request('/logout', {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        redirect: 'manual',
      });
      assertEquals(res.status, 302);
      assertEquals(res.headers.get('location'), '/login');
      const setCookie = res.headers.get('set-cookie') || '';
      assertNotEquals(setCookie.indexOf('Max-Age=0'), -1);
    });

    await globalTeardown();
  },
});
