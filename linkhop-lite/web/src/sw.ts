/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
import { createDeviceHeartbeat } from "../../src/protocol/events.js";
import { registryTopicFromConfig } from "../../src/protocol/topics.js";
import type { DeviceConfig } from "../../src/protocol/types.js";

declare const self: ServiceWorkerGlobalScope;
const BG_HEARTBEAT_TAG = "linkhop-heartbeat";

interface BrowserConfigLike {
  device: DeviceConfig;
  transport_kind?: "ntfy" | "relay";
  transport_url?: string;
  ntfy_url?: string;
}

async function loadBrowserConfigFromIDB(): Promise<BrowserConfigLike | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open("linkhop-lite", 1);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("config", "readonly");
      const store = tx.objectStore("config");
      const browserReq = store.get("browser");
      browserReq.onsuccess = () => {
        resolve((browserReq.result as BrowserConfigLike | undefined) ?? null);
      };
      browserReq.onerror = () => resolve(null);
    };
  });
}

async function publishBackgroundHeartbeat(): Promise<void> {
  const cfg = await loadBrowserConfigFromIDB();
  if (!cfg?.device) return;
  const baseUrl = cfg.transport_url ?? cfg.ntfy_url ?? "https://ntfy.sh";
  const topic = registryTopicFromConfig(cfg.device);
  const event = createDeviceHeartbeat(cfg.device);
  await fetch(`${baseUrl}/${topic}`, {
    method: "POST",
    body: JSON.stringify(event),
  });
}

async function saveBackgroundHeartbeatLastTriggerAt(timestamp: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.open("linkhop-lite", 1);
    req.onerror = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("config", "readwrite");
      tx.objectStore("config").put(timestamp, "bg_heartbeat_last_trigger_at");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    };
  });
}

async function saveLastPeriodicUpdateSentAt(timestamp: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.open("linkhop-lite", 1);
    req.onerror = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("config", "readwrite");
      tx.objectStore("config").put(timestamp, "last_periodic_update_sent_at");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    };
  });
}

async function broadcastBackgroundHeartbeatTrigger(timestamp: string): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: "bg-heartbeat-triggered", timestamp });
  }
}

// Derive base path from the service worker's own location.
// If SW is at /LinkHop/sw.js, base will be /LinkHop/
const swBase = new URL("./", self.location.href).pathname;

// Handle Web Share Target: intercept GET <base>share and redirect to the app with params
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === `${swBase}share` && event.request.method === "GET") {
    const shareUrl = url.searchParams.get("url") ?? "";
    const shareTitle = url.searchParams.get("title") ?? "";
    const shareText = url.searchParams.get("text") ?? "";
    const params = new URLSearchParams();
    if (shareUrl) params.set("share-url", shareUrl);
    if (shareTitle) params.set("share-title", shareTitle);
    if (shareText) params.set("share-text", shareText);
    event.respondWith(Response.redirect(`${swBase}?${params}`, 303));
  }
});

// Workbox injects the precache manifest here (handles all other fetches)
precacheAndRoute(self.__WB_MANIFEST);

// Activate immediately and take control of all open tabs so that a
// newly deployed version is used on next reload rather than waiting
// for all tabs to close first.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("periodicsync", (event: Event) => {
  const periodicEvent = event as Event & {
    tag?: string;
    waitUntil: (promise: Promise<unknown>) => void;
  };
  if (periodicEvent.tag !== BG_HEARTBEAT_TAG) return;
  periodicEvent.waitUntil(
    (async () => {
      await publishBackgroundHeartbeat();
      const now = new Date().toISOString();
      await saveLastPeriodicUpdateSentAt(now);
      await saveBackgroundHeartbeatLastTriggerAt(now);
      await broadcastBackgroundHeartbeatTrigger(now);
    })().catch(() => {
      // Best effort only.
    }),
  );
});

// Handle push events (from ntfy web push or future integrations)
self.addEventListener("push", (event) => {
  let title = "LinkHop Lite";
  let body = "New message";
  let data: Record<string, unknown> = {};

  if (event.data) {
    try {
      const payload = event.data.json();
      // ntfy push payload format
      if (payload.message) {
        body = payload.message;
      }
      if (payload.title) {
        title = payload.title;
      }
      // Try parsing the message as a LinkHop protocol event
      if (typeof payload.message === "string") {
        try {
          const protoEvent = JSON.parse(payload.message);
          if (protoEvent.type === "msg.send") {
            const msgBody = protoEvent.payload?.body;
            const msgId: string = protoEvent.payload?.msg_id;
            if (msgBody?.kind === "text") {
              title = `LinkHop: ${protoEvent.from_device_id}`;
              body = msgBody.text;
              data = { msg_id: msgId };
            } else if (msgBody?.kind === "url") {
              title = `LinkHop: ${protoEvent.from_device_id} shared a link`;
              body = msgBody.title ?? msgBody.url;
              data = { msg_id: msgId, url: msgBody.url };
            }
          }
        } catch {
          // Not a protocol event, use raw message
        }
      }
    } catch {
      // Not JSON, try text
      body = event.data.text() || body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: `${swBase}icon.svg`,
      tag: "linkhop-push",
      renotify: true,
      data,
      actions: [
        { action: "mark-viewed", title: "Mark as Read" },
        { action: "open", title: "Open" },
      ],
    }),
  );
});

// Handle notification clicks and action buttons
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const msgId: string | undefined = event.notification.data?.msg_id;

  if (event.action === "mark-viewed") {
    // Mark viewed without opening the app — postMessage any open window
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.postMessage({ type: "mark-viewed", msg_id: msgId });
            return;
          }
        }
        // No open window — nothing to do; message stays "received" until next open
      }),
    );
    return;
  }

  const targetUrl: string | undefined = event.notification.data?.url;

  // If this is a URL message, open the URL directly and mark it viewed.
  // openWindow must be called immediately (not after async matchAll) to
  // avoid being silently blocked as a popup on Android.
  if (targetUrl) {
    event.waitUntil(self.clients.openWindow(targetUrl));
    // Best-effort: notify any open app window to mark the message as viewed
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.postMessage({ type: "mark-viewed", msg_id: msgId });
            break;
          }
        }
      }),
    );
    return;
  }

  // Default click or "open" action: focus/open the app and navigate to the message
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return (client as WindowClient).focus().then((c) => {
            c.postMessage({ type: "open-message", msg_id: msgId });
          });
        }
      }
      // No existing window — open with msg param so app can pick it up on load
      const appUrl = msgId ? `${swBase}?msg=${encodeURIComponent(msgId)}` : swBase;
      return self.clients.openWindow(appUrl);
    }),
  );
});
