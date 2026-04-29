/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
import { swPutInboxMessage, swPutReceipt, swFetchNewMessages, addNotifiedMsgId } from "./rs-sw.js";
import type { MessageRecord, MsgSendEvent } from "../../src/protocol/types.js";

declare const self: ServiceWorkerGlobalScope;

// Derive base path from the service worker's own location
const swBase = new URL("./", self.location.href).pathname;

// Handle Web Share Target: intercept GET <base>share and redirect to the app
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

// Workbox precaches all static assets
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle push events from ntfy VAPID
self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event: PushEvent): Promise<void> {
  let title = "LinkHop";
  let body = "New message";
  let msgId: string | undefined;
  let notifUrl: string | undefined;
  let networkId: string | undefined;
  let msgRecord: MessageRecord | undefined;

  if (event.data) {
    try {
      const payload = event.data.json() as Record<string, unknown>;

      // ntfy wraps the protocol event as a JSON string in payload.message
      const raw = typeof payload.message === "string" ? payload.message : null;
      if (raw) {
        try {
          const proto = JSON.parse(raw) as MsgSendEvent;
          if (proto.type === "msg.send") {
            networkId = proto.network_id;
            msgId = proto.payload.msg_id;
            const msgBody = proto.payload.body;

            if (msgBody.kind === "text") {
              title = `LinkHop from ${proto.from_device_id}`;
              body = msgBody.text;
            } else if (msgBody.kind === "url") {
              title = `LinkHop: link shared`;
              body = msgBody.title ?? msgBody.url;
              notifUrl = msgBody.url;
            } else {
              title = "LinkHop";
              body = "[Encrypted message]";
            }

            // Build a MessageRecord to write to RS so sender sees receipt
            const now = new Date().toISOString();
            msgRecord = {
              msg_id: proto.payload.msg_id,
              from_device_id: proto.from_device_id,
              to_device_id: proto.payload.to_device_id,
              body: msgBody,
              created_at: proto.timestamp,
              state: "received",
              last_attempt_id: proto.payload.attempt_id,
              last_attempt_at: proto.timestamp,
              received_at: now,
              viewed_at: null,
            };
          }
        } catch { /* raw wasn't a protocol event */ }
      }

      if (payload.title && typeof payload.title === "string") title = payload.title;
    } catch {
      body = event.data.text() || body;
    }
  }

  // Write to this device's inbox + send receipt to the sender (best effort — SW has ~30s budget)
  if (networkId && msgRecord) {
    const toDevice = msgRecord.to_device_id;
    const fromDevice = msgRecord.from_device_id;
    const now = new Date().toISOString();
    await Promise.all([
      swPutInboxMessage(networkId, toDevice, { ...msgRecord, received_at: now }).catch(() => {}),
      swPutReceipt(networkId, fromDevice, msgRecord.msg_id, now, toDevice).catch(() => {}),
    ]);
  }

  await self.registration.showNotification(title, {
    body,
    icon: `${swBase}icon.svg`,
    tag: `linkhop-${msgId ?? "push"}`,
    renotify: true,
    data: { msg_id: msgId, url: notifUrl },
    actions: [
      { action: "mark-viewed", title: "Mark as Read" },
      { action: "open", title: "Open" },
    ],
  });

  // Mark as notified so the background RS poll doesn't re-notify for this message
  if (msgId) await addNotifiedMsgId(msgId).catch(() => {});
}

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const msgId: string | undefined = event.notification.data?.msg_id;

  if (event.action === "mark-viewed") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.postMessage({ type: "mark-viewed", msg_id: msgId });
            return;
          }
        }
      }),
    );
    return;
  }

  const targetUrl: string | undefined = event.notification.data?.url;

  if (targetUrl) {
    event.waitUntil(self.clients.openWindow(targetUrl));
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

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return (client as WindowClient).focus().then((c) => {
            c.postMessage({ type: "open-message", msg_id: msgId });
          });
        }
      }
      const appUrl = msgId ? `${swBase}?msg=${encodeURIComponent(msgId)}` : swBase;
      return self.clients.openWindow(appUrl);
    }),
  );
});

/**
 * Poll RS for new messages and show notifications.
 * Used by both Background Sync (on reconnect) and Periodic Background Sync (scheduled).
 */
async function backgroundFetchAndNotify(): Promise<void> {
  const newMessages = await swFetchNewMessages();
  for (const { record } of newMessages) {
    const msgBody = record.body;
    let title = "LinkHop";
    let body = "New message";
    let notifUrl: string | undefined;

    if (msgBody.kind === "text") {
      title = `LinkHop from ${record.from_device_id}`;
      body = msgBody.text;
    } else if (msgBody.kind === "url") {
      title = "LinkHop: link shared";
      body = msgBody.title ?? msgBody.url;
      notifUrl = msgBody.url;
    } else {
      body = "[Encrypted message]";
    }

    await self.registration.showNotification(title, {
      body,
      icon: `${swBase}icon.svg`,
      tag: `linkhop-${record.msg_id}`,
      renotify: true,
      data: { msg_id: record.msg_id, url: notifUrl },
      actions: [
        { action: "mark-viewed", title: "Mark as Read" },
        { action: "open", title: "Open" },
      ],
    });
  }
}

// Background Sync: fires when device comes back online after being offline
self.addEventListener("sync", (event: Event) => {
  const syncEvent = event as Event & { tag: string; waitUntil: (p: Promise<unknown>) => void };
  if (syncEvent.tag === "linkhop-send-retry" || syncEvent.tag === "linkhop-bg-fetch") {
    syncEvent.waitUntil(backgroundFetchAndNotify().catch(() => {}));
  }
});

// Periodic Background Sync: fires on a schedule even when the app is closed
// Requires installed PWA + browser permission (Chrome Android only currently)
self.addEventListener("periodicsync", (event: Event) => {
  const syncEvent = event as Event & { tag: string; waitUntil: (p: Promise<unknown>) => void };
  if (syncEvent.tag === "linkhop-poll") {
    syncEvent.waitUntil(backgroundFetchAndNotify().catch(() => {}));
  }
});
