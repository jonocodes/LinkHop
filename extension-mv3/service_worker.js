/**
 * LinkHop MV3 service worker.
 * Receives messages via Web Push and handles notification clicks.
 */

const STORAGE_KEY = "linkhop_config";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => resolve(result[STORAGE_KEY] || null));
  });
}

function saveConfig(config) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: config }, resolve);
  });
}

function clearConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEY, resolve);
  });
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function apiFetch(config, path, options = {}) {
  const url = `${config.serverUrl.replace(/\/$/, "")}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// ---------------------------------------------------------------------------
// Push subscription
// ---------------------------------------------------------------------------

async function registerPush(config) {
  const resp = await apiFetch(config, "/api/push/config");
  if (!resp.ok) throw new Error(`push/config returned ${resp.status}`);
  const pushConfig = await resp.json();
  if (!pushConfig.supported) throw new Error("push not configured on server");
  if (!pushConfig.vapid_public_key) throw new Error("missing VAPID key");

  const existing = await self.registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(pushConfig.vapid_public_key),
    }));

  const saveResp = await apiFetch(config, "/api/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({ ...subscription.toJSON(), client_type: "extension" }),
  });
  if (!saveResp.ok) throw new Error(`push/subscriptions returned ${saveResp.status}`);
}

async function unregisterPush(config) {
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return;
    await apiFetch(config, "/api/push/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  } catch (err) {
    console.error("[LinkHop] Push unregistration failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Push events
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const body = data.type === "url" ? data.body : (data.body?.slice(0, 100) || "New message");

  event.waitUntil(
    self.registration.showNotification("LinkHop", {
      body,
      icon: chrome.runtime.getURL("icons/icon-96.png"),
      data: { messageId: data.message_id, type: data.type, body: data.body },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { type, body } = event.notification.data || {};

  if (type === "url" && body) {
    event.waitUntil(clients.openWindow(body));
  }
});

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "linkhop-send-page", title: "Send page via LinkHop", contexts: ["page"] });
  chrome.contextMenus.create({ id: "linkhop-send-link", title: "Send link via LinkHop", contexts: ["link"] });
  chrome.contextMenus.create({ id: "linkhop-send-selection", title: "Send selection via LinkHop", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const config = await getConfig();
  if (!config?.token || !config?.defaultDeviceId) {
    chrome.action.openPopup();
    return;
  }

  let type, body;
  if (info.menuItemId === "linkhop-send-link") { type = "url"; body = info.linkUrl; }
  else if (info.menuItemId === "linkhop-send-selection") { type = "text"; body = info.selectionText; }
  else { type = "url"; body = tab.url; }

  const resp = await apiFetch(config, "/api/messages", {
    method: "POST",
    body: JSON.stringify({ recipient_device_id: config.defaultDeviceId, type, body }),
  });

  if (resp.ok) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-96.png"),
      title: "LinkHop",
      message: "Sent!",
    });
  }
});

// ---------------------------------------------------------------------------
// Message handler (from popup and content script)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "session_link" && msg.token && msg.serverUrl) {
      const config = {
        serverUrl: msg.serverUrl,
        token: msg.token,
        deviceId: msg.deviceId,
        deviceName: msg.deviceName,
        defaultDeviceId: null,
      };
      await saveConfig(config);
      await registerPush(config);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "register_push") {
      const config = await getConfig();
      if (!config) { sendResponse({ ok: false, error: "not linked" }); return; }
      try {
        await registerPush(config);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      return;
    }

    if (msg.type === "unlinked") {
      const config = await getConfig();
      if (config) await unregisterPush(config);
      await clearConfig();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "get_status") {
      const subscription = await self.registration.pushManager.getSubscription().catch(() => null);
      sendResponse({ pushEnabled: !!subscription });
      return;
    }
  })();
  return true; // keep channel open for async response
});
