# LinkHop Firefox Extension

Sends and receives links between your devices via LinkHop. Uses Manifest V2 with SSE for real-time delivery — works on local networks without internet access.

See `../extension-mv3/` for the Chrome (Manifest V3 / Web Push) version.

## Loading in Firefox (development)

1. Open `about:debugging`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Select `extension/manifest.json`

## Setup

1. Click the extension icon
2. Enter your LinkHop server URL and click **Open settings**
3. On the `/inbox` page that opens, click **🧩 extension**
4. The extension is now linked as the same device as your browser — no separate device is created

## Features

- **SSE real-time delivery** — background script maintains a persistent connection to `/api/events/stream` and shows browser notifications when messages arrive
- **Send current page** — click the icon, pick a device, hit Send
- **Context menu** — right-click any page, link, or selection to send via LinkHop
- **Notification click** — opens the URL in a new tab and marks the message as opened
- **Shared device** — the extension reuses the same device token as your browser session, so it appears as one device in your device list

## How it works

Linking is done via a `postMessage` bridge: the `/inbox` page posts the device token to a content script, which relays it to the background script via `browser.runtime.sendMessage`. The background script saves the config and opens an SSE connection.

The background script connects to `/api/events/stream?token=...` using `EventSource`. When a `message` event arrives it fetches the full message, shows a native notification, and records `received` + `presented` signals. Clicking the notification records `opened` and opens the URL.
