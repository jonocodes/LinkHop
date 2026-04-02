import { createApp } from './app.ts';
import { getConfig } from './config.ts';
import { getDb } from './db.ts';

const config = await getConfig();
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
