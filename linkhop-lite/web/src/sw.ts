/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Handle Web Share Target: intercept GET /share and redirect to the app with params
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === "/share" && event.request.method === "GET") {
    const shareUrl = url.searchParams.get("url") ?? "";
    const shareTitle = url.searchParams.get("title") ?? "";
    const shareText = url.searchParams.get("text") ?? "";
    const params = new URLSearchParams();
    if (shareUrl) params.set("share-url", shareUrl);
    if (shareTitle) params.set("share-title", shareTitle);
    if (shareText) params.set("share-text", shareText);
    event.respondWith(Response.redirect(`/?${params}`, 303));
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
              data = { msg_id: msgId };
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
      icon: "/icon.svg",
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
      const url = msgId ? `/?msg=${encodeURIComponent(msgId)}` : "/";
      return self.clients.openWindow(url);
    }),
  );
});
