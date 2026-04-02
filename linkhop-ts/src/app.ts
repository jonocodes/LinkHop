import { Hono } from '@hono/hono';
import { serveStatic } from '@hono/hono/deno';
import { getConfig } from './config.ts';
import { optionalAuth } from './middleware/auth.ts';
import { api } from './routes/api.ts';
import { pages } from './routes/pages.ts';

export async function createApp(): Promise<Hono> {
  const app = new Hono();
  const staticConfig = await getConfig();

  app.use('*', async (c, next) => {
    c.set('config', await getConfig());
    await next();
  });

  app.use('*', optionalAuth());
  app.use(
    '/styles.css',
    serveStatic({ path: './public/styles.css', root: staticConfig.appDir }),
  );
  app.use(
    '/service-worker.js',
    serveStatic({
      path: './public/service-worker.js',
      root: staticConfig.appDir,
    }),
  );
  app.use(
    '/manifest.json',
    serveStatic({ path: './public/manifest.json', root: staticConfig.appDir }),
  );
  app.use(
    '/push.js',
    serveStatic({ path: './public/push.js', root: staticConfig.appDir }),
  );
  app.use(
    '/pwa-register.js',
    serveStatic({
      path: './public/pwa-register.js',
      root: staticConfig.appDir,
    }),
  );
  app.use(
    '/inbox.js',
    serveStatic({ path: './public/inbox.js', root: staticConfig.appDir }),
  );

  app.route('/', pages);
  app.route('/api', api);

  return app;
}
