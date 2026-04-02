import { loadSync } from '@std/dotenv';
import { dirname, fromFileUrl, isAbsolute, join } from '@std/path';
import type { AppConfig } from './types.ts';
import { generateSessionSecret } from './utils/crypto.ts';

const APP_DIR = dirname(fromFileUrl(import.meta.url));
const ROOT_DIR = dirname(APP_DIR);
const ENV_PATH = join(ROOT_DIR, '.env');

let cachedConfig: AppConfig | null = null;

export function getConfig(refresh = false): AppConfig {
  if (cachedConfig && !refresh) {
    return cachedConfig;
  }

  loadSync({ envPath: ENV_PATH, export: true });

  const sessionSecret = readEnv('SESSION_SECRET') || generateSessionSecret();
  const dbPath = readEnv('DB_PATH') || './data/linkhop.db';

  cachedConfig = {
    appDir: ROOT_DIR,
    publicDir: join(ROOT_DIR, 'public'),
    envPath: ENV_PATH,
    host: readEnv('HOST') || '0.0.0.0',
    port: Number(readEnv('PORT') || '8000'),
    dbPath: isAbsolute(dbPath) ? dbPath : join(ROOT_DIR, dbPath),
    passwordHash: readEnv('PASSWORD_HASH') || '',
    vapidPublicKey: readEnv('VAPID_PUBLIC_KEY') || '',
    vapidPrivateKey: readEnv('VAPID_PRIVATE_KEY') || '',
    vapidSubject: readEnv('VAPID_SUBJECT') || 'mailto:admin@localhost',
    sessionSecret,
    sessionCookieName: 'linkhop_session',
    deviceCookieName: 'linkhop_device',
    allowSelfSend: (readEnv('ALLOW_SELF_SEND') || 'false') === 'true',
  };

  return cachedConfig;
}

export function applyRuntimeConfig(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    Deno.env.set(key, value);
  }
  cachedConfig = null;
}

function readEnv(name: string): string {
  const value = Deno.env.get(name) || '';
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
