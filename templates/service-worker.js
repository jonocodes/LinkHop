const CACHE_NAME = "{{ cache_name }}";
const SHELL_ASSETS = [{% for asset in shell_assets %}"{{ asset }}"{% if not forloop.last %}, {% endif %}{% endfor %}];
const STATIC_PREFIX = "{{ static_prefix }}";
const AUTH_DB_NAME = "linkhop-pwa";
const AUTH_STORE_NAME = "kv";
const AUTH_TOKEN_KEY = "deviceToken";
const MSG_DB_NAME = "linkhop-messages";
const MSG_STORE_NAME = "messages";
const MSG_DB_VERSION = 1;
let linkhopDeviceToken = null;

// ---------------------------------------------------------------------------
// Auth IndexedDB (existing)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Messages IndexedDB
// ---------------------------------------------------------------------------

function openMessagesDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(MSG_DB_NAME, MSG_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MSG_STORE_NAME)) {
        const store = db.createObjectStore(MSG_STORE_NAME, { keyPath: "id" });
        store.createIndex("by_created", "created_at", { unique: false });
        store.createIndex("by_read", "read", { unique: false });
        store.createIndex("by_direction", "direction", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeMessage(msg) {
  return openMessagesDb().then((db) => {
    if (!db) return undefined;

    return new Promise((resolve) => {
      const tx = db.transaction(MSG_STORE_NAME, "readwrite");
      tx.objectStore(MSG_STORE_NAME).put(msg);
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

function getAllMessages() {
  return openMessagesDb().then((db) => {
    if (!db) return [];

    return new Promise((resolve) => {
      const tx = db.transaction(MSG_STORE_NAME, "readonly");
      const store = tx.objectStore(MSG_STORE_NAME);
      const index = store.index("by_created");
      const request = index.openCursor(null, "prev");
      const results = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve(results);
      };
      tx.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  });
}

function markMessageRead(id) {
  return openMessagesDb().then((db) => {
    if (!db) return undefined;

    return new Promise((resolve) => {
      const tx = db.transaction(MSG_STORE_NAME, "readwrite");
      const store = tx.objectStore(MSG_STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const msg = getReq.result;
        if (msg) {
          msg.read = true;
          store.put(msg);
        }
      };
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

function deleteMessage(id) {
  return openMessagesDb().then((db) => {
    if (!db) return undefined;

    return new Promise((resolve) => {
      const tx = db.transaction(MSG_STORE_NAME, "readwrite");
      tx.objectStore(MSG_STORE_NAME).delete(id);
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

function clearAllMessages() {
  return openMessagesDb().then((db) => {
    if (!db) return undefined;

    return new Promise((resolve) => {
      const tx = db.transaction(MSG_STORE_NAME, "readwrite");
      tx.objectStore(MSG_STORE_NAME).clear();
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Service Worker Lifecycle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Message handling from pages
// ---------------------------------------------------------------------------

self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "linkhop_push_auth" && event.data.token) {
    event.waitUntil(storeAuthToken(event.data.token));
    return;
  }

  // Store an outgoing message from the send page
  if (event.data.type === "linkhop_store_sent" && event.data.message) {
    event.waitUntil(storeMessage(event.data.message));
    return;
  }

  // Inbox page requests
  if (event.data.type === "linkhop_get_messages" && event.ports && event.ports[0]) {
    event.waitUntil(
      getAllMessages().then((messages) => {
        event.ports[0].postMessage({ messages: messages });
      })
    );
    return;
  }

  if (event.data.type === "linkhop_mark_read" && event.data.id) {
    event.waitUntil(markMessageRead(event.data.id));
    return;
  }

  if (event.data.type === "linkhop_delete_message" && event.data.id) {
    event.waitUntil(deleteMessage(event.data.id));
    return;
  }

  if (event.data.type === "linkhop_clear_messages") {
    event.waitUntil(clearAllMessages());
    return;
  }
});

// ---------------------------------------------------------------------------
// Push notification handling
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_err) {
    data = {};
  }

  const isUrl = data.type === "url";
  const body = (data.body || "").length > 100 ? data.body.slice(0, 97) + "..." : (data.body || "");

  // Store incoming message in IndexedDB
  const incomingMessage = {
    id: data.message_id || crypto.randomUUID(),
    type: data.type || "text",
    body: data.body || "",
    sender: data.sender || "unknown",
    recipient_device_id: data.recipient_device_id || "",
    created_at: data.created_at || new Date().toISOString(),
    read: false,
    direction: "incoming",
    test: !!data.test,
  };

  event.waitUntil(
    storeMessage(incomingMessage).then(() => {
      // Notify open clients so the inbox can refresh
      return self.clients.matchAll({ type: "window", includeUncontrolled: true });
    }).then((clients) => {
      const payload = {
        type: "linkhop_push_notified",
        messageId: incomingMessage.id,
      };
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
        tag: `linkhop-${incomingMessage.id}`,
        data: {
          messageId: incomingMessage.id,
          type: data.type,
          url: isUrl ? data.body : "/account/inbox/",
        },
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || "/account/inbox/";
  const messageId = notifData.messageId;

  event.waitUntil(
    Promise.resolve(messageId ? markMessageRead(messageId) : undefined).then(() => {
      return self.clients.matchAll({ type: "window", includeUncontrolled: true });
    }).then((clients) => {
      // For URL messages, open the URL directly
      if (notifData.type === "url") {
        return self.clients.openWindow(targetUrl);
      }

      // For text messages, navigate to inbox
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate("/account/inbox/");
          return client.focus();
        }
      }
      return self.clients.openWindow("/account/inbox/");
    })
  );
});

// ---------------------------------------------------------------------------
// Push subscription change
// ---------------------------------------------------------------------------

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
