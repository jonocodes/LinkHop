import { Hono } from '@hono/hono';
import { getCookie } from '@hono/hono/cookie';
import { getDb } from '../db.ts';
import { requireDeviceToken, requireSession } from '../middleware/auth.ts';
import { listActiveDevices } from '../services/devices.ts';
import {
  MessageValidationError,
  relayMessage,
  resolveRecipient,
} from '../services/messages.ts';
import {
  deactivatePushSubscription,
  getPublicPushConfig,
  relayPushMessage,
  upsertPushSubscription,
} from '../services/push.ts';
import type { DeviceRecord } from '../types.ts';

export const api = new Hono();

function serializeDevice(device: DeviceRecord) {
  return {
    id: device.id,
    name: device.name,
    is_active: device.is_active,
    device_type: device.device_type,
    browser: device.browser,
    os: device.os,
    last_seen_at: device.last_seen_at,
    last_push_at: device.last_push_at,
    created_at: device.created_at,
    revoked_at: device.revoked_at,
  };
}

api.get('/me', requireSession(), (c) => {
  return c.json({ authenticated: true });
});

api.get('/push/config', (c) => {
  return c.json(getPublicPushConfig(c.get('config')));
});

api.get('/device/me', requireDeviceToken(), (c) => {
  return c.json(serializeDevice(c.get('device')!));
});

api.get('/devices', requireDeviceToken(), (c) => {
  const config = c.get('config');
  return c.json({
    devices: listActiveDevices(getDb(config)).map(serializeDevice),
    allow_self_send: config.allowSelfSend,
  });
});

api.post('/push/subscriptions', requireDeviceToken(), async (c) => {
  const body = await c.req.json();
  const device = c.get('device');
  const db = getDb(c.get('config'));

  const endpoint = String(body.endpoint || '');
  const p256dh = String(body.keys?.p256dh || '');
  const authSecret = String(body.keys?.auth || '');

  if (!endpoint || !p256dh || !authSecret || !device) {
    return c.json({ error: 'invalid subscription payload' }, 400);
  }

  upsertPushSubscription(db, {
    device,
    endpoint,
    p256dh,
    authSecret,
    clientType: String(body.client_type || ''),
    userAgent: c.req.header('user-agent') || '',
  });

  return c.body(null, 204);
});

api.delete('/push/subscriptions', requireDeviceToken(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const endpoint = String(body.endpoint || '');

  if (!endpoint) {
    return c.json({ error: 'endpoint required' }, 400);
  }

  deactivatePushSubscription(getDb(c.get('config')), {
    deviceId: c.get('device')!.id,
    endpoint,
  });

  return c.body(null, 204);
});

api.post('/messages', requireDeviceToken(), async (c) => {
  const contentType = c.req.header('content-type') || '';
  const body = contentType.includes('application/json')
    ? await c.req.json()
    : Object.fromEntries(
      Object.entries(await c.req.parseBody()).map((
        [key, value],
      ) => [key, String(value)]),
    );

  const to = String(body.to || body.recipient_device_id || '');
  const type = String(body.type || '');
  const messageBody = String(body.body || '');

  if (!to || !['url', 'text'].includes(type) || !messageBody.trim()) {
    return c.json({ error: 'invalid message payload' }, 400);
  }

  const db = getDb(c.get('config'));
  const recipient = resolveRecipient(db, to);
  if (!recipient) {
    return c.json({ error: 'recipient device was not found' }, 404);
  }

  try {
    const result = await relayMessage(db, c.get('config'), {
      senderDevice: c.get('device')!,
      recipientDevice: recipient,
      messageType: type,
      body: messageBody,
    });
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof MessageValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

api.post('/push/test', requireDeviceToken(), async (c) => {
  const device = c.get('device');
  if (!device) {
    return c.json({ error: 'device authentication required' }, 401);
  }

  const messageId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const testBody = 'LinkHop push test - it works!';

  const result = await relayPushMessage(
    getDb(c.get('config')),
    c.get('config'),
    {
      device,
      messageId,
      messageType: 'text',
      body: testBody,
      senderName: device.name,
      recipientDeviceId: device.id,
      createdAt,
      isTest: true,
    },
  );

  if (!result.total) {
    return c.json({
      error: 'no active push subscription found for this device',
    }, 400);
  }

  // Echo for the client: inbox reads from IndexedDB; push delivery can be late or dropped
  // while the tab is focused, so the SPA ingests this in parallel with the push event.
  return c.json({
    ok: true,
    subscriptions: result.total,
    delivered: result.delivered,
    message: {
      id: messageId,
      type: 'text',
      body: testBody,
      sender: device.name,
      recipient_device_id: device.id,
      created_at: createdAt,
      read: false,
      direction: 'incoming',
      test: true,
    },
  });
});

api.post('/session/link', (c) => {
  if (!c.get('session')) {
    return c.json({ error: 'session required' }, 401);
  }

  const token = getCookie(c, c.get('config').deviceCookieName) || '';
  if (!token || !c.get('device')) {
    return c.json({ error: 'device cookie required' }, 400);
  }

  return c.json({
    device: serializeDevice(c.get('device')!),
    token,
  });
});
