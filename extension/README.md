# LinkHop Firefox Extension

Sends and receives links between your devices via LinkHop.

## Loading in Firefox (development)

1. Open `about:debugging`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Select `extension/manifest.json`

## Setup

1. Click the extension icon
2. Enter your LinkHop server URL (e.g. `https://hop.example.com`)
3. Go to your LinkHop account → **Add device** to get a pairing PIN
4. Enter the PIN and a device name, click **Link device**

## Features

- **SSE real-time subscriptions** — background script maintains a persistent connection and shows browser notifications when messages arrive
- **Send current page** — click the icon, pick a device, hit Send
- **Context menu** — right-click any page, link, or selection to send via LinkHop
- **Notification click** — opens the URL in a new tab and marks the message as opened

## How it works

The background script connects to `/api/events/stream?token=...` using `EventSource`. When a `message` event arrives it fetches the full message via `/api/messages/{id}`, shows a native notification, and records `received` + `presented` signals. Clicking the notification records `opened` and opens the URL.
