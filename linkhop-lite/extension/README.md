# LinkHop Lite Browser Extension

Keep your LinkHop Lite subscriptions alive when the web app tab is closed.

## How it works

LinkHop Lite uses SSE connections to ntfy for real-time messaging. When the browser tab is closed, those connections die and the device goes offline. This extension watches for incoming messages and wakes up the web app tab when something arrives.

The extension does **not** process events, manage state, send acks, or show notifications itself. It is a thin watcher that delegates everything to the web app.

### Tab-aware behavior

- **Tab is open** — extension is idle. The web app handles its own SSE connections and notifications.
- **Tab is closed** — extension holds SSE connections to ntfy. When a `msg.send` event arrives addressed to the local device, it opens/focuses the linkhop-lite tab. The tab boots up, reconnects with `?since=30s`, processes the message, shows the notification, sends the ack.

This avoids all state duplication, notification dedup, and ack coordination issues.

### Config sharing (no separate login)

The extension reads config directly from the linkhop-lite web app — there is no separate account or login. A content script injected on the app page (via `chrome.tabs.executeScript`) reads the IndexedDB config and sends it to the background page. The extension only needs:

- `ntfy_url` — which ntfy server to connect to
- `device_id` — to filter messages addressed to this device
- Registry and device topic names
- App URL

No encryption keys or engine state needed.

### App URL

The extension defaults to the deployed GitHub Pages site:

    https://jonocodes.github.io/LinkHop/

This is configurable in the extension popup. The content script is injected programmatically on the configured URL (no broad match patterns needed).

### When it stops

- User clicks "Disconnect" in the extension popup — closes SSE, clears config
- User does "leave network" in the web app — content script notifies extension to disconnect

## Architecture

```
Background Page (persistent, MV2)
  - SSE connections to ntfy (registry + device topics)
  - Watches for msg.send events addressed to local device_id
  - Opens/focuses the web app tab when a message arrives
  - Idle when the web app tab is already open

Content Script (injected on app page via chrome.tabs.executeScript)
  - Reads config from web app's IndexedDB
  - Sends config to background page on page load
  - Notifies background page on leave/disconnect

Popup
  - Status display (watching / tab open / disconnected / not configured)
  - Device name
  - App URL field (editable, defaults to GitHub Pages)
  - Open App button (focuses existing tab or opens new one)
  - Disconnect button
```

## Popup UI States

### Not configured
No device linked yet. Shows app URL field and "Open App" button so the user can open the app and connect.

### Tab open, extension idle
Shows device name and indicates the app is handling messages directly.

### Tab closed, extension watching
Shows device name and indicates the extension is watching for messages. SSE connections are active.

### Disconnected
User chose to stop. Shows reconnect option.

## Manifest V3 Migration Notes

The current extension uses Manifest V2 for its persistent background page, which allows holding SSE connections indefinitely. A future MV3 version would need to work around the ephemeral service worker lifecycle (terminated after ~30s of inactivity).

### Option 1: Offscreen Document (Chrome-only)

`chrome.offscreen.createDocument()` can host a long-lived SSE connection in an invisible page. This preserves real-time delivery but is **not supported in Firefox**. The offscreen document communicates with the service worker via `chrome.runtime.sendMessage`.

### Option 2: Polling with chrome.alarms (cross-browser)

`chrome.alarms` fires at a minimum 30-second interval. Each alarm wakes the service worker to poll ntfy using `GET /{topic}/json?since=30s&poll=1`. Not truly real-time (~30s latency), but works across all browsers and is simpler to implement.

### Option 3: Hybrid

Use offscreen documents on Chrome for real-time, fall back to alarm-based polling on Firefox. More code to maintain but gives the best experience per browser.
