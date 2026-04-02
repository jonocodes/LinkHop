import type { Database } from '@db/sqlite';
import webpush from 'web-push';
import type {
  AppConfig,
  DeviceRecord,
  PushSubscriptionRecord,
} from '../types.ts';

export function pushIsConfigured(config: AppConfig): boolean {
  return Boolean(config.vapidPublicKey && config.vapidPrivateKey);
}

export function getPublicPushConfig(config: AppConfig): {
  supported: boolean;
  vapid_public_key: string;
} {
  return {
    supported: pushIsConfigured(config),
    vapid_public_key: pushIsConfigured(config) ? config.vapidPublicKey : '',
  };
}

export function upsertPushSubscription(
  db: Database,
  input: {
    device: DeviceRecord;
    endpoint: string;
    p256dh: string;
    authSecret: string;
    clientType?: string;
    userAgent?: string;
  },
): void {
  const statement = db.prepare(`
    INSERT INTO push_subscriptions (
      id, device_id, endpoint, p256dh, auth_secret, client_type, user_agent, is_active, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)
    ON CONFLICT(endpoint) DO UPDATE SET
      device_id = excluded.device_id,
      p256dh = excluded.p256dh,
      auth_secret = excluded.auth_secret,
      client_type = excluded.client_type,
      user_agent = excluded.user_agent,
      is_active = 1,
      last_error = NULL
  `);

  try {
    statement.run([
      crypto.randomUUID(),
      input.device.id,
      input.endpoint,
      input.p256dh,
      input.authSecret,
      (input.clientType || '').slice(0, 20) || null,
      (input.userAgent || '').slice(0, 255) || null,
    ]);
  } finally {
    statement.finalize();
  }
}

export function deactivatePushSubscription(
  db: Database,
  input: { deviceId: string; endpoint: string },
): void {
  const statement = db.prepare(`
    UPDATE push_subscriptions
    SET is_active = 0, last_failure_at = datetime('now')
    WHERE device_id = ? AND endpoint = ? AND is_active = 1
  `);

  try {
    statement.run([input.deviceId, input.endpoint]);
  } finally {
    statement.finalize();
  }
}

function listActiveSubscriptions(
  db: Database,
  deviceId: string,
): PushSubscriptionRecord[] {
  const statement = db.prepare(`
    SELECT * FROM push_subscriptions
    WHERE device_id = ? AND is_active = 1
    ORDER BY created_at ASC
  `);

  try {
    const subscriptions = statement.all([deviceId]) as PushSubscriptionRecord[];
    const extensionSubscriptions = subscriptions.filter((subscription) =>
      subscription.client_type === 'extension'
    );
    return extensionSubscriptions.length
      ? extensionSubscriptions
      : subscriptions;
  } finally {
    statement.finalize();
  }
}

function markPushSuccess(
  db: Database,
  deviceId: string,
  subscriptionId: string,
): void {
  const subscriptionStatement = db.prepare(`
    UPDATE push_subscriptions
    SET last_success_at = datetime('now'), last_error = NULL
    WHERE id = ?
  `);
  const deviceStatement = db.prepare(`
    UPDATE devices
    SET last_push_at = datetime('now')
    WHERE id = ?
  `);

  try {
    subscriptionStatement.run([subscriptionId]);
    deviceStatement.run([deviceId]);
  } finally {
    subscriptionStatement.finalize();
    deviceStatement.finalize();
  }
}

function markPushFailure(
  db: Database,
  subscriptionId: string,
  message: string,
  deactivate = false,
): void {
  const statement = db.prepare(`
    UPDATE push_subscriptions
    SET
      last_failure_at = datetime('now'),
      last_error = ?,
      is_active = CASE WHEN ? THEN 0 ELSE is_active END
    WHERE id = ?
  `);

  try {
    statement.run([message.slice(0, 255), deactivate ? 1 : 0, subscriptionId]);
  } finally {
    statement.finalize();
  }
}

export async function relayPushMessage(
  db: Database,
  config: AppConfig,
  input: {
    device: DeviceRecord;
    messageId: string;
    messageType: string;
    body: string;
    senderName: string;
    recipientDeviceId: string;
    createdAt: string;
    isTest?: boolean;
  },
): Promise<{ delivered: number; total: number }> {
  if (!pushIsConfigured(config)) {
    return { delivered: 0, total: 0 };
  }

  const subscriptions = listActiveSubscriptions(db, input.device.id);
  if (!subscriptions.length) {
    return { delivered: 0, total: 0 };
  }

  webpush.setVapidDetails(
    config.vapidSubject,
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );

  const payload = JSON.stringify({
    message_id: input.messageId,
    type: input.messageType,
    body: input.body,
    sender: input.senderName,
    recipient_device_id: input.recipientDeviceId,
    created_at: input.createdAt,
    ...(input.isTest ? { test: true } : {}),
  });

  let delivered = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth_secret,
          },
        },
        payload,
      );
      delivered += 1;
      markPushSuccess(db, input.device.id, subscription.id);
    } catch (error) {
      const statusCode = error instanceof Error && 'statusCode' in error
        ? Number(error.statusCode)
        : undefined;
      markPushFailure(
        db,
        subscription.id,
        error instanceof Error ? error.message : 'Push delivery failed',
        statusCode === 404 || statusCode === 410,
      );
    }
  }

  return { delivered, total: subscriptions.length };
}
