import { createApp } from './app.ts';
import { getConfig } from './config.ts';
import { getDb } from './db.ts';

const config = await getConfig();

const missing: string[] = [];
if (!config.passwordHash) missing.push('PASSWORD_HASH');
if (!config.vapidPublicKey) missing.push('VAPID_PUBLIC_KEY');
if (!config.vapidPrivateKey) missing.push('VAPID_PRIVATE_KEY');

if (missing.length) {
  console.error(
    `Missing required env var${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
  );
  console.error('Set them in .env or environment and restart.');
  Deno.exit(1);
}

getDb(config);

const app = await createApp();

console.log(`LinkHop TS listening on http://${config.host}:${config.port}`);

Deno.serve(
  {
    hostname: config.host,
    port: config.port,
  },
  app.fetch,
);
