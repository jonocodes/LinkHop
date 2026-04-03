import { Hono } from '@hono/hono';
import { getConfig } from './config.ts';
import { optionalAuth, readSession, requireSession } from './middleware/auth.ts';
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

  const { serveStatic } = await import('@hono/hono/deno');
  const staticOpts = { root: staticConfig.appDir };
  const spaHandler = serveStatic({ path: './public/app.html', ...staticOpts });

  app.use('/styles.css', serveStatic({ path: './public/styles.css', ...staticOpts }));
  app.use('/service-worker.js', serveStatic({ path: './public/service-worker.js', ...staticOpts }));
  app.use('/manifest.json', serveStatic({ path: './public/manifest.json', ...staticOpts }));
  app.use('/push.js', serveStatic({ path: './public/push.js', ...staticOpts }));
  app.use('/pwa-register.js', serveStatic({ path: './public/pwa-register.js', ...staticOpts }));
  app.use('/inbox.js', serveStatic({ path: './public/inbox.js', ...staticOpts }));
  app.use('/app.js', serveStatic({ path: './public/app.js', ...staticOpts }));
  app.use('/app.html', serveStatic({ path: './public/app.html', ...staticOpts }));

  app.get('/account/inbox', requireSession(), spaHandler);
  app.get('/account/send', requireSession(), spaHandler);
  app.get('/account/devices', requireSession(), spaHandler);
  app.get('/account/settings', requireSession(), spaHandler);

  app.route('/', pages);
  app.route('/api', api);

  return app;
}