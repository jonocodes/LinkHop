# LinkHop Lite Browser Extension

Keep your LinkHop Lite subscriptions alive when the web app tab is closed.

## How it works

LinkHop Lite uses SSE connections to ntfy for real-time messaging. When the browser tab is closed or backgrounded, those connections die and the device goes offline. This extension maintains those connections in a persistent background page so the device stays online and messages are received.

### Config sharing (no separate login)

The extension reads config directly from the linkhop-lite web app — there is no separate account or login. A content script running on the app page reads the IndexedDB config (`network_id`, `device_id`, `ntfy_url`, encryption keys) and passes it to the extension background page.

### What the extension does

- Holds persistent SSE connections to the **registry topic** and **device topic** on ntfy
- Processes incoming events (validate, decrypt, reduce state)
- Shows browser notifications for new incoming messages
- Periodically re-announces the device so peers see it as online
- Syncs state back when the web app tab is reopened

### When it stops

- User does "leave network" in the web app — content script notifies extension, which closes connections and clears config
- Extension popup disconnect button

## Default app URL

The extension defaults to the deployed GitHub Pages site:

    https://jonocodes.github.io/LinkHop/

This is configurable in the extension popup.

## Architecture

```
Background Page (persistent)
  - SSE connections to ntfy (registry + device topics)
  - Event processing (validate, decrypt, engine reduce)
  - chrome.notifications for incoming messages
  - Periodic re-announce (heartbeat)
  - Stores config + state in chrome.storage

Content Script (runs on linkhop-lite page)
  - Reads config from web app's IndexedDB
  - Sends config to background page
  - Relays leave/disconnect events

Popup
  - Connection status display
  - Device info
  - Disconnect button
  - App URL configuration
```

## Manifest V3 Migration Notes

The current extension uses Manifest V2 for its persistent background page, which allows holding SSE connections indefinitely. A future MV3 version would need to work around the ephemeral service worker lifecycle (terminated after ~30s of inactivity).

### Option 1: Offscreen Document (Chrome-only)

`chrome.offscreen.createDocument()` can host a long-lived SSE connection in an invisible page. This preserves real-time delivery but is **not supported in Firefox**. The offscreen document communicates with the service worker via `chrome.runtime.sendMessage`.

### Option 2: Polling with chrome.alarms (cross-browser)

`chrome.alarms` fires at a minimum 30-second interval. Each alarm wakes the service worker to poll ntfy using `GET /{topic}/json?since=30s&poll=1`. Not truly real-time (~30s latency), but works across all browsers and is simpler to implement.

### Option 3: Hybrid

Use offscreen documents on Chrome for real-time, fall back to alarm-based polling on Firefox. More code to maintain but gives the best experience per browser.
