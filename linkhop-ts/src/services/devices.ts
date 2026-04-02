import type { Database } from '@db/sqlite';
import type { DeviceRecord, DeviceType } from '../types.ts';
import { randomToken, sha256Hex } from '../utils/crypto.ts';

export async function createDevice(
  db: Database,
  input: {
    name: string;
    deviceType?: DeviceType;
    browser?: string | null;
    os?: string | null;
  },
): Promise<{ device: DeviceRecord; token: string }> {
  const token = randomToken('device_');
  const tokenHash = await sha256Hex(token);
  const id = crypto.randomUUID();

  const statement = db.prepare(`
    INSERT INTO devices (id, name, token_hash, is_active, device_type, browser, os)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `);

  try {
    statement.run([
      id,
      input.name.trim(),
      tokenHash,
      input.deviceType || 'browser',
      input.browser || null,
      input.os || null,
    ]);
  } finally {
    statement.finalize();
  }

  return {
    device: getDeviceById(db, id)!,
    token,
  };
}

export function getDeviceById(db: Database, id: string): DeviceRecord | null {
  const statement = db.prepare('SELECT * FROM devices WHERE id = ? LIMIT 1');
  try {
    return (statement.get([id]) as DeviceRecord | undefined) || null;
  } finally {
    statement.finalize();
  }
}

export async function getDeviceByToken(
  db: Database,
  token: string,
): Promise<DeviceRecord | null> {
  const tokenHash = await sha256Hex(token);
  const statement = db.prepare(`
    SELECT * FROM devices
    WHERE token_hash = ? AND is_active = 1 AND revoked_at IS NULL
    LIMIT 1
  `);

  try {
    return (statement.get([tokenHash]) as DeviceRecord | undefined) || null;
  } finally {
    statement.finalize();
  }
}

export function listActiveDevices(db: Database): DeviceRecord[] {
  const statement = db.prepare(`
    SELECT * FROM devices
    WHERE is_active = 1 AND revoked_at IS NULL
    ORDER BY lower(name)
  `);

  try {
    return statement.all() as DeviceRecord[];
  } finally {
    statement.finalize();
  }
}

export function touchDeviceSeen(db: Database, deviceId: string): void {
  const statement = db.prepare(`
    UPDATE devices
    SET last_seen_at = datetime('now')
    WHERE id = ?
  `);

  try {
    statement.run([deviceId]);
  } finally {
    statement.finalize();
  }
}
