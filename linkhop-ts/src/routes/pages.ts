import { Hono } from '@hono/hono';
import { getCookie } from '@hono/hono/cookie';
import { getConfig } from '../config.ts';
import { getDb } from '../db.ts';
import {
  clearSessionCookie,
  requireDevice,
  requireSession,
  setDeviceCookie,
  setSessionCookie,
} from '../middleware/auth.ts';
import { createDevice, listActiveDevices } from '../services/devices.ts';
import { verifyPassword } from '../services/setup.ts';
import { deviceTable, layout } from '../utils/html.ts';

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

  await setSessionCookie(c, config);
  return c.redirect('/account/inbox');
});

pages.get('/logout', async (c) => {
  clearSessionCookie(c, await getConfig());
  return c.redirect('/login');
});

pages.get('/account/inbox', requireSession(), requireDevice(), (c) => {
  const device = c.get('device');
  const token = getCookie(c, c.get('config').deviceCookieName) || '';
  return c.html(layout({
    title: 'Inbox',
    heading: 'Inbox',
    activePath: '/account/inbox',
    body: `
      <p>Current device: <strong>${device?.name}</strong></p>
      <div id="push-bar" class="stack" style="display:none">
        <div class="row">
          <span id="push-copy">Enable push notifications for this device?</span>
          <button id="push-btn" type="button">Enable Push</button>
          <button id="push-disable" type="button" class="quiet" style="display:none">Disable</button>
          <button id="push-test" type="button" class="quiet">Test Push</button>
        </div>
        <div id="push-status" class="muted" style="display:none"></div>
      </div>
      <div class="row">
        <button id="filter-all" type="button">All</button>
        <button id="filter-incoming" type="button">Incoming</button>
        <button id="filter-sent" type="button">Sent</button>
        <button id="btn-clear" type="button" class="quiet">Clear all</button>
      </div>
      <div id="message-list"></div>
      <p id="empty-state" class="muted" style="display:none">No messages yet. Messages arrive via push and are stored in this browser.</p>
      <script src="/pwa-register.js"></script>
      <script src="/push.js"></script>
      <script src="/inbox.js"></script>
      <script>
        window.LinkHopInbox?.boot({
          token: ${JSON.stringify(token)},
          deviceId: ${JSON.stringify(device?.id || '')},
          deviceName: ${JSON.stringify(device?.name || '')}
        });
      </script>
    `,
  }));
});

pages.get('/account/send', requireSession(), requireDevice(), (c) => {
  const db = getDb(c.get('config'));
  const devices = listActiveDevices(db);
  const currentDevice = c.get('device');
  const token = getCookie(c, c.get('config').deviceCookieName) || '';
  const options = devices
    .filter((device) => device.id !== currentDevice?.id)
    .map((device) => `<option value="${device.id}">${device.name}</option>`)
    .join('');

  return c.html(layout({
    title: 'Send',
    heading: 'Send',
    activePath: '/account/send',
    body: `
      <form id="send-form">
        <label>Recipient
          <select name="to" required>
            ${options || '<option value="">No other devices yet</option>'}
          </select>
        </label>
        <label>Type
          <select name="type">
            <option value="url">URL</option>
            <option value="text">Text</option>
          </select>
        </label>
        <label>Body <textarea name="body" rows="6" required></textarea></label>
        <button type="submit">Send</button>
      </form>
      <p id="send-status" class="muted" style="display:none"></p>
      <script src="/pwa-register.js"></script>
      <script>
        (function () {
          var form = document.getElementById('send-form');
          var status = document.getElementById('send-status');
          var token = ${JSON.stringify(token)};
          var senderName = ${JSON.stringify(currentDevice?.name || '')};

          function setStatus(text, isError) {
            status.style.display = text ? '' : 'none';
            status.textContent = text;
            status.style.color = isError ? '#9f1239' : '';
          }

          form.addEventListener('submit', async function (event) {
            event.preventDefault();
            setStatus('Sending...', false);

            var formData = new FormData(form);
            var payload = {
              recipient_device_id: String(formData.get('to') || ''),
              type: String(formData.get('type') || ''),
              body: String(formData.get('body') || '')
            };

            try {
              var response = await fetch('/api/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify(payload)
              });
              var data = await response.json().catch(function () { return {}; });

              if (!response.ok) {
                setStatus(data.error || 'Send failed.', true);
                return;
              }

              if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                var selected = form.querySelector('select[name="to"]');
                var recipientName = selected && selected.selectedOptions[0]
                  ? selected.selectedOptions[0].textContent
                  : 'device';
                navigator.serviceWorker.controller.postMessage({
                  type: 'linkhop_store_sent',
                  message: {
                    id: data.id,
                    type: data.type,
                    body: data.body,
                    sender: senderName,
                    recipient_name: recipientName,
                    recipient_device_id: data.recipient_device_id,
                    created_at: data.created_at,
                    read: true,
                    direction: 'sent'
                  }
                });
              }

              form.reset();
              setStatus(
                data.push_delivered
                  ? 'Sent successfully.'
                  : 'Accepted, but no active push subscription delivered it yet.',
                false,
              );
            } catch (_error) {
              setStatus('Send failed.', true);
            }
          });
        })();
      </script>
    `,
  }));
});

pages.get('/account/devices', requireSession(), (c) => {
  const db = getDb(c.get('config'));
  return c.html(layout({
    title: 'Devices',
    heading: 'Devices',
    activePath: '/account/devices',
    body: `
      ${deviceTable(listActiveDevices(db))}
      <p><a href="/account/activate-device">Register this browser</a></p>
    `,
  }));
});

pages.get('/account/activate-device', requireSession(), (c) => {
  const currentToken = getCookie(c, c.get('config').deviceCookieName);

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
      <p>Bookmarklet support is not wired yet. This page stays in the route map so the rewrite matches the Django surface.</p>
    `,
  }));
});

pages.get('/account/settings', requireSession(), async (c) => {
  const config = await getConfig();
  return c.html(layout({
    title: 'Settings',
    heading: 'Settings',
    activePath: '/account/settings',
    body: `
      <dl>
        <dt>DB path</dt>
        <dd><code>${config.dbPath}</code></dd>
        <dt>VAPID subject</dt>
        <dd><code>${config.vapidSubject}</code></dd>
      </dl>
      <p>Password change and rate-limit controls come in a later pass.</p>
    `,
  }));
});

pages.get('/hop', requireDevice(), (c) => c.redirect('/account/send'));
pages.get('/share', requireDevice(), (c) => c.redirect('/account/send'));

pages.get('/healthz', (c) => c.json({ ok: true }));
