const CACHE_NAME = "{{ cache_name }}";
const SHELL_ASSETS = [{% for asset in shell_assets %}"{{ asset }}"{% if not forloop.last %}, {% endif %}{% endfor %}];
const STATIC_PREFIX = "{{ static_prefix }}";
const AUTH_DB_NAME = "linkhop-pwa";
const AUTH_STORE_NAME = "kv";
const AUTH_TOKEN_KEY = "deviceToken";
let linkhopDeviceToken = null;

function openAuthDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(AUTH_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(AUTH_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeAuthToken(token) {
  linkhopDeviceToken = token;

  return openAuthDb().then((db) => {
    if (!db) return undefined;

    return new Promise((resolve) => {
      const tx = db.transaction(AUTH_STORE_NAME, "readwrite");
      tx.objectStore(AUTH_STORE_NAME).put(token, AUTH_TOKEN_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(undefined);
      };
      tx.onerror = () => {
        db.close();
        resolve(undefined);
      };
    });
  });
}

function loadAuthToken() {
  if (linkhopDeviceToken) {
    return Promise.resolve(linkhopDeviceToken);
  }

  return openAuthDb().then((db) => {
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction(AUTH_STORE_NAME, "readonly");
      const request = tx.objectStore(AUTH_STORE_NAME).get(AUTH_TOKEN_KEY);
      request.onsuccess = () => {
        linkhopDeviceToken = request.result || null;
        resolve(linkhopDeviceToken);
      };
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  }).catch(() => null);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (!url.pathname.startsWith(STATIC_PREFIX) && url.pathname !== "/manifest.json") {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});

self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "linkhop_push_auth" && event.data.token) {
    event.waitUntil(storeAuthToken(event.data.token));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_err) {
    data = {};
  }

  const isUrl = data.type === "url";
  const body = (data.body || "").length > 100 ? data.body.slice(0, 97) + "..." : (data.body || "");
  const targetUrl = isUrl ? `/messages/${data.message_id}/open` : `/messages/${data.message_id}`;
  const payload = {
    type: "linkhop_push_notified",
    messageId: data.message_id || null,
  };

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage(payload));

      const hasVisibleClient = clients.some(
        (client) => client.visibilityState === "visible" || client.focused
      );
      if (hasVisibleClient && !data.test) {
        return undefined;
      }

      return self.registration.showNotification("LinkHop", {
        body: body || "New message received",
        icon: "{{ icon_url }}",
        badge: "{{ icon_url }}",
        tag: `linkhop-${data.message_id || "message"}`,
        data: {
          url: targetUrl,
        },
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/inbox";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: "linkhop_push_refresh_required" }));

      return loadAuthToken().then((token) => {
        if (!token) {
          return undefined;
        }

        return fetch("/api/push/config", {
          headers: {
            "Authorization": "Bearer " + token,
          },
        })
          .then((response) => response.ok ? response.json() : null)
          .then((config) => {
            if (!config || !config.supported || !config.vapid_public_key) {
              return undefined;
            }

            return self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(config.vapid_public_key),
            });
          })
          .then((subscription) => {
            if (!subscription) {
              return undefined;
            }

            return fetch("/api/push/subscriptions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token,
              },
              body: JSON.stringify(subscription.toJSON()),
            });
          })
          .catch(() => undefined);
      });
    })
  );
});
