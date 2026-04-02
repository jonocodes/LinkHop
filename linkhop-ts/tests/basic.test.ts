import { assertEquals, assertThrows } from 'jsr:@std/assert';
import {
  decodeBase64Url,
  encodeBase64Url,
} from '../src/utils/base64url.ts';
import {
  generateSessionSecret,
  randomToken,
  sha256Hex,
  signHmac,
} from '../src/utils/crypto.ts';
import {
  MessageValidationError,
  validateMessage,
} from '../src/services/messages.ts';

Deno.test('base64url: encode and decode round-trip', () => {
  const original = 'Hello, LinkHop!';
  const encoded = encodeBase64Url(original);
  const decoded = decodeBase64Url(encoded);
  assertEquals(new TextDecoder().decode(decoded), original);
});

Deno.test('base64url: encode produces no + / = characters', () => {
  for (const input of ['a>b?', 'test data here', '\x00\x01\x02\xff']) {
    const encoded = encodeBase64Url(input);
    assertEquals(encoded.includes('+'), false);
    assertEquals(encoded.includes('/'), false);
    assertEquals(encoded.includes('='), false);
  }
});

Deno.test('base64url: encode Uint8Array', () => {
  const bytes = new Uint8Array([72, 101, 108, 108, 111]);
  const encoded = encodeBase64Url(bytes);
  assertEquals(encoded, 'SGVsbG8');
});

Deno.test('crypto: sha256Hex produces consistent hex', async () => {
  const hash1 = await sha256Hex('hello');
  const hash2 = await sha256Hex('hello');
  assertEquals(hash1, hash2);
  assertEquals(hash1.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(hash1), true);
});

Deno.test('crypto: sha256Hex differs for different inputs', async () => {
  const a = await sha256Hex('foo');
  const b = await sha256Hex('bar');
  assertEquals(a === b, false);
});

Deno.test('crypto: randomToken has correct prefix', () => {
  const withPrefix = randomToken('device_');
  assertEquals(withPrefix.startsWith('device_'), true);

  const noPrefix = randomToken();
  assertEquals(noPrefix.startsWith('device_'), false);
});

Deno.test('crypto: randomToken produces unique values', () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 100; i++) {
    tokens.add(randomToken());
  }
  assertEquals(tokens.size, 100);
});

Deno.test('crypto: generateSessionSecret is base64url', () => {
  const secret = generateSessionSecret();
  assertEquals(/^[A-Za-z0-9_-]+$/.test(secret), true);
  assertEquals(secret.length >= 40, true);
});

Deno.test('crypto: signHmac produces consistent signature', async () => {
  const sig1 = await signHmac('secret', 'payload');
  const sig2 = await signHmac('secret', 'payload');
  assertEquals(sig1, sig2);
});

Deno.test('crypto: signHmac differs for different payloads', async () => {
  const a = await signHmac('secret', 'one');
  const b = await signHmac('secret', 'two');
  assertEquals(a === b, false);
});

Deno.test('messages: validateMessage accepts valid url', () => {
  validateMessage('url', 'https://example.com');
});

Deno.test('messages: validateMessage accepts valid text', () => {
  validateMessage('text', 'hello world');
});

Deno.test('messages: validateMessage rejects bad type', () => {
  assertThrows(
    () => validateMessage('image', 'data'),
    MessageValidationError,
    "must be 'url' or 'text'",
  );
});

Deno.test('messages: validateMessage rejects url too long', () => {
  const longUrl = 'https://example.com/' + 'a'.repeat(2048);
  assertThrows(
    () => validateMessage('url', longUrl),
    MessageValidationError,
    '2048 characters',
  );
});

Deno.test('messages: validateMessage rejects non-http url', () => {
  assertThrows(
    () => validateMessage('url', 'ftp://example.com'),
    MessageValidationError,
    'http or https',
  );
});

Deno.test('messages: validateMessage rejects invalid url', () => {
  assertThrows(
    () => validateMessage('url', 'not-a-url'),
    MessageValidationError,
    'http or https',
  );
});

Deno.test('messages: validateMessage rejects text too long', () => {
  const longText = 'x'.repeat(8001);
  assertThrows(
    () => validateMessage('text', longText),
    MessageValidationError,
    '8000 characters',
  );
});

Deno.test('messages: validateMessage rejects empty text', () => {
  assertThrows(
    () => validateMessage('text', '   '),
    MessageValidationError,
    'cannot be empty',
  );
});

Deno.test({
  name: 'self-send: blocked when ALLOW_SELF_SEND=false',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { Database } = await import('@db/sqlite');
    const { getDb } = await import('../src/db.ts');
    const { createDevice } = await import('../src/services/devices.ts');
    const { relayMessage } = await import('../src/services/messages.ts');
    const { applyRuntimeConfig, getConfig } = await import('../src/config.ts');
    const { stringify } = await import('@std/dotenv');
    const { join } = await import('@std/path');
    const { hashPassword } = await import('../src/services/setup.ts');

    const tmpDir = await Deno.makeTempDir({ prefix: 'linkhop_self_' });
    const envPath = join(tmpDir, '.env');
    const dbPath = join(tmpDir, 'test.db');
    const passwordHash = await hashPassword('pass');

    await Deno.writeTextFile(envPath, stringify({
      PASSWORD_HASH: passwordHash,
      SESSION_SECRET: 'self-test',
      VAPID_PUBLIC_KEY: 'x',
      VAPID_PRIVATE_KEY: 'y',
      DB_PATH: dbPath,
      ALLOW_SELF_SEND: 'false',
    }));
    applyRuntimeConfig({
      PASSWORD_HASH: passwordHash,
      SESSION_SECRET: 'self-test',
      VAPID_PUBLIC_KEY: 'x',
      VAPID_PRIVATE_KEY: 'y',
      DB_PATH: dbPath,
      ALLOW_SELF_SEND: 'false',
    });

    const config = getConfig(true);
    const db = getDb(config);
    const { device } = await createDevice(db, { name: 'SelfDev' });

    try {
      await relayMessage(db, config, {
        senderDevice: device,
        recipientDevice: device,
        messageType: 'text',
        body: 'self ping',
      });
      throw new Error('should have thrown');
    } catch (e) {
      if (!(e instanceof (await import('../src/services/messages.ts')).MessageValidationError)) {
        throw e;
      }
    }

    await Deno.remove(tmpDir, { recursive: true });
  },
});

Deno.test({
  name: 'self-send: allowed when ALLOW_SELF_SEND=true',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { Database } = await import('@db/sqlite');
    const { getDb } = await import('../src/db.ts');
    const { createDevice } = await import('../src/services/devices.ts');
    const { relayMessage } = await import('../src/services/messages.ts');
    const { applyRuntimeConfig, getConfig } = await import('../src/config.ts');
    const { stringify } = await import('@std/dotenv');
    const { join } = await import('@std/path');
    const { hashPassword } = await import('../src/services/setup.ts');

    const tmpDir = await Deno.makeTempDir({ prefix: 'linkhop_self2_' });
    const envPath = join(tmpDir, '.env');
    const dbPath = join(tmpDir, 'test.db');
    const passwordHash = await hashPassword('pass');

    await Deno.writeTextFile(envPath, stringify({
      PASSWORD_HASH: passwordHash,
      SESSION_SECRET: 'self-test2',
      VAPID_PUBLIC_KEY: 'x',
      VAPID_PRIVATE_KEY: 'y',
      DB_PATH: dbPath,
      ALLOW_SELF_SEND: 'true',
    }));
    applyRuntimeConfig({
      PASSWORD_HASH: passwordHash,
      SESSION_SECRET: 'self-test2',
      VAPID_PUBLIC_KEY: 'x',
      VAPID_PRIVATE_KEY: 'y',
      DB_PATH: dbPath,
      ALLOW_SELF_SEND: 'true',
    });

    const config = getConfig(true);
    const db = getDb(config);
    const { device } = await createDevice(db, { name: 'SelfDev2' });

    const result = await relayMessage(db, config, {
      senderDevice: device,
      recipientDevice: device,
      messageType: 'text',
      body: 'self ping',
    });
    assertEquals(result.body, 'self ping');
    assertEquals(result.sender_device_id, device.id);
    assertEquals(result.recipient_device_id, device.id);

    await Deno.remove(tmpDir, { recursive: true });
  },
});
