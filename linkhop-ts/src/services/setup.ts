import { parse, stringify } from '@std/dotenv';
import { compare, hash } from 'bcryptjs';
import { applyRuntimeConfig, getConfig } from '../config.ts';
import { generateSessionSecret, generateVapidKeys } from '../utils/crypto.ts';

export async function hashPassword(password: string): Promise<string> {
  return await hash(password, 12);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!passwordHash) {
    return false;
  }

  return await compare(password, passwordHash);
}

export async function persistSetup(password: string): Promise<void> {
  const config = await getConfig(true);
  const passwordHash = await hashPassword(password);
  const sessionSecret = generateSessionSecret();
  const vapid = await generateVapidKeys();

  let existing: Record<string, string> = {};
  try {
    existing = parse(await Deno.readTextFile(config.envPath));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  const next = {
    ...existing,
    PASSWORD_HASH: passwordHash,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    SESSION_SECRET: sessionSecret,
    VAPID_SUBJECT: existing.VAPID_SUBJECT || 'mailto:admin@localhost',
    PORT: existing.PORT || '8000',
    HOST: existing.HOST || '0.0.0.0',
    DB_PATH: existing.DB_PATH || './data/linkhop.db',
    LOG_LEVEL: existing.LOG_LEVEL || 'info',
    RATE_LIMIT_SENDS: existing.RATE_LIMIT_SENDS || '30',
    RATE_LIMIT_REGISTRATIONS: existing.RATE_LIMIT_REGISTRATIONS || '10',
    ALLOW_SELF_SEND: existing.ALLOW_SELF_SEND || 'false',
  };

  await Deno.writeTextFile(config.envPath, `${stringify(next)}\n`);
  applyRuntimeConfig(next);
}
