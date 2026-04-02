# LinkHop Chrome Extension (MV3)

Sends and receives links between your devices via LinkHop. Uses Manifest V3 with Web Push for notifications — required for Chrome.

See `../extension/` for the Firefox (Manifest V2 / SSE) version.

## Loading in Chrome (development)

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the `extension-mv3/` folder

## Setup

1. Click the extension icon
2. Enter your LinkHop server URL and click **Open settings**
3. On the `/account/inbox/` page that opens, click **🧩 extension**
4. The extension is now linked
5. Open the popup and click **Enable notifications** to register for Web Push

## Features

- **Web Push notifications** — server delivers messages via the browser push service; works even when the popup is closed
- **Send current page** — click the icon, pick a device, hit Send
- **Context menu** — right-click any page, link, or selection to send via LinkHop
- **Notification click** — opens the URL in a new tab

## Differences from the Firefox (MV2) extension

| | Firefox MV2 | Chrome MV3 |
|---|---|---|
| Real-time delivery | SSE (direct connection) | Web Push (via Mozilla/Google) |
| Works offline / LAN only | ✅ Yes | ❌ No — requires internet |
| Persistent background | ✅ Yes | ❌ No (service worker) |
| Notification permission | Automatic | Must click "Enable notifications" in popup |

## How it works

Linking uses the same `postMessage` bridge as the Firefox extension: the `/account/inbox/` page sends the device token to a content script, which relays it to the service worker.

On setup the service worker fetches the VAPID public key from `/api/push/config`, subscribes via `pushManager.subscribe()`, and registers the subscription with `/api/push/subscriptions`. Incoming messages trigger a `push` event in the service worker, which calls `showNotification()`. Clicking a notification opens the URL and marks the message as opened.

## Requirements

- VAPID keys must be configured on the server (`LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY` / `LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY`)
- Internet access is required for push delivery (messages are relayed via the browser vendor's push service)
