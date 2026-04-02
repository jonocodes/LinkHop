import type { DeviceRecord } from '../types.ts';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function layout(input: {
  title: string;
  body: string;
  heading?: string;
  activePath?: string;
  flash?: string | null;
}): string {
  const links = [
    ['/account/inbox', 'Inbox'],
    ['/account/send', 'Send'],
    ['/account/devices', 'Devices'],
    ['/account/settings', 'Settings'],
  ];

  const nav = input.activePath
    ? `<nav>${
      links.map(([href, label]) => {
        const active = href === input.activePath ? ' class="active"' : '';
        return `<a href="${href}"${active}>${label}</a>`;
      }).join('')
    }<a href="/logout">Logout</a></nav>`
    : '';

  const flash = input.flash
    ? `<p class="flash">${escapeHtml(input.flash)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <link rel="stylesheet" href="/styles.css" />
    <link rel="manifest" href="/manifest.json" />
  </head>
  <body>
    <main class="shell">
      <header class="hero">
        <p class="eyebrow">LinkHop TS</p>
        <h1>${escapeHtml(input.heading || input.title)}</h1>
        ${nav}
      </header>
      ${flash}
      <section class="card">
        ${input.body}
      </section>
    </main>
  </body>
</html>`;
}

export function deviceTable(devices: DeviceRecord[]): string {
  if (!devices.length) {
    return '<p>No devices registered yet.</p>';
  }

  return `<table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Type</th>
        <th>Browser</th>
        <th>OS</th>
        <th>Last seen</th>
      </tr>
    </thead>
    <tbody>
      ${
    devices.map((device) => `
        <tr>
          <td>${escapeHtml(device.name)}</td>
          <td>${escapeHtml(device.device_type)}</td>
          <td>${escapeHtml(device.browser || '—')}</td>
          <td>${escapeHtml(device.os || '—')}</td>
          <td>${escapeHtml(device.last_seen_at || 'Never')}</td>
        </tr>
      `).join('')
  }
    </tbody>
  </table>`;
}
