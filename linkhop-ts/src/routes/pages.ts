import { Hono } from '@hono/hono';
import { getConfig } from '../config.ts';
import { getDb } from '../db.ts';
import {
  clearSessionCookie,
  requireSession,
  setDeviceCookie,
} from '../middleware/auth.ts';
import { createDevice } from '../services/devices.ts';
import { verifyPassword } from '../services/setup.ts';
import { layout } from '../utils/html.ts';

export const pages = new Hono();

pages.get('/', (c) => {
  if (c.get('session')) {
    return c.redirect('/account/inbox');
  }
  return c.redirect('/login');
});

pages.get('/login', (c) => {
  return c.html(layout({
    title: 'Login',
    heading: 'Sign in',
    body: `
      <form method="post">
        <label>Password <input type="password" name="password" autocomplete="current-password" required /></label>
        <button type="submit">Log in</button>
      </form>
    `,
  }));
});

pages.post('/login', async (c) => {
  const config = await getConfig();
  const body = await c.req.parseBody();
  const password = String(body.password || '');

  if (!await verifyPassword(password, config.passwordHash)) {
    return c.html(
      layout({
        title: 'Login',
        heading: 'Sign in',
        flash: 'Invalid password.',
        body: `
        <form method="post">
          <label>Password <input type="password" name="password" autocomplete="current-password" required /></label>
          <button type="submit">Log in</button>
        </form>
      `,
      }),
      401,
    );
  }

  const { setSessionCookie } = await import('../middleware/auth.ts');
  await setSessionCookie(c, config);
  return c.redirect('/account/inbox');
});

pages.get('/logout', async (c) => {
  const { clearSessionCookie } = await import('../middleware/auth.ts');
  clearSessionCookie(c, await getConfig());
  return c.redirect('/login');
});

pages.get('/account/activate-device', requireSession(), (c) => {
  const currentToken = c.req.header('cookie')?.includes('linkhop_device');
  return c.html(layout({
    title: 'Activate device',
    heading: 'Activate this browser',
    activePath: '/account/devices',
    flash: currentToken
      ? 'This browser already has a device token. Submitting again will replace it in this browser only.'
      : null,
    body: `
      <form method="post">
        <label>Device name <input type="text" name="name" minlength="2" maxlength="80" required /></label>
        <button type="submit">Register device</button>
      </form>
    `,
  }));
});

pages.post('/account/activate-device', requireSession(), async (c) => {
  const db = getDb(c.get('config'));
  const body = await c.req.parseBody();
  const name = String(body.name || '').trim();

  if (name.length < 2) {
    return c.html(
      layout({
        title: 'Activate device',
        heading: 'Activate this browser',
        flash: 'Device name must be at least 2 characters.',
        body: `
        <form method="post">
          <label>Device name <input type="text" name="name" minlength="2" maxlength="80" required /></label>
          <button type="submit">Register device</button>
        </form>
      `,
      }),
      400,
    );
  }

  try {
    const device = await createDevice(db, {
      name,
      deviceType: 'browser',
      browser: c.req.header('user-agent') || null,
    });

    const { setDeviceCookie } = await import('../middleware/auth.ts');
    setDeviceCookie(c, c.get('config'), device.token);
    return c.redirect('/account/inbox');
  } catch {
    return c.html(
      layout({
        title: 'Activate device',
        heading: 'Activate this browser',
        flash: 'Device name already exists.',
        body: `
        <form method="post">
          <label>Device name <input type="text" name="name" minlength="2" maxlength="80" required /></label>
          <button type="submit">Register device</button>
        </form>
      `,
      }),
      400,
    );
  }
});

pages.get('/account/bookmarklet', requireSession(), (c) => {
  return c.html(layout({
    title: 'Bookmarklet',
    heading: 'Bookmarklet',
    activePath: '/account/settings',
    body: `
      <p>Bookmarklet support is not wired yet.</p>
    `,
  }));
});

pages.get('/hop', requireSession(), (c) => c.redirect('/account/send'));
pages.get('/share', requireSession(), (c) => c.redirect('/account/send'));

pages.get('/healthz', (c) => c.json({ ok: true }));