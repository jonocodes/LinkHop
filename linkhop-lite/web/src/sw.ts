/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Workbox injects the precache manifest here
precacheAndRoute(self.__WB_MANIFEST);

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
          if (protoEvent.type === "msg.send" && protoEvent.payload?.body?.text) {
            title = `LinkHop: ${protoEvent.from_device_id}`;
            body = protoEvent.payload.body.text;
            data = protoEvent;
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
    }),
  );
});

// Open app when notification is clicked
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow("/");
    }),
  );
});
