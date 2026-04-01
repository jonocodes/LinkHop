/**
 * LinkHop background script.
 * Maintains SSE connection and handles incoming message notifications.
 */

// Chrome/Firefox compatibility shim
const browser = globalThis.browser || globalThis.chrome;

const STORAGE_KEY = "linkhop_config";

let eventSource = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getConfig() {
  return new Promise((resolve) => {
    browser.storage.local.get(STORAGE_KEY, (result) => {
      resolve(result[STORAGE_KEY] || null);
    });
  });
}

async function saveConfig(config) {
  return new Promise((resolve) => {
    browser.storage.local.set({ [STORAGE_KEY]: config }, resolve);
  });
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch(config, path, options = {}) {
  const url = `${config.serverUrl.replace(/\/$/, "")}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return resp;
}

async function fetchMessage(config, messageId) {
  const resp = await apiFetch(config, `/api/messages/${messageId}`);
  if (!resp.ok) return null;
  return resp.json();
}

async function markReceived(config, messageId) {
  await apiFetch(config, `/api/messages/${messageId}/received`, { method: "POST" });
}

async function markPresented(config, messageId) {
  await apiFetch(config, `/api/messages/${messageId}/presented`, { method: "POST" });
}

async function markOpened(config, messageId) {
  await apiFetch(config, `/api/messages/${messageId}/opened`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function showNotification(messageId, message) {
  const isUrl = message.type === "url";
  browser.notifications.create(`msg:${messageId}`, {
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/icon-48.svg"),
    title: "LinkHop",
    message: isUrl ? message.body : message.body.slice(0, 100),
  });
}

browser.notifications.onClicked.addListener(async (notificationId) => {
  if (!notificationId.startsWith("msg:")) return;
  const messageId = notificationId.slice(4);

  const config = await getConfig();
  if (!config) return;

  const message = await fetchMessage(config, messageId);
  if (message) {
    if (message.type === "url") {
      browser.tabs.create({ url: message.body });
    }
    markOpened(config, messageId);
  }

  browser.notifications.clear(notificationId);
});

// ---------------------------------------------------------------------------
// SSE connection
// ---------------------------------------------------------------------------

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(
    1000 * Math.pow(2, reconnectAttempts) + Math.random() * 500,
    MAX_RECONNECT_DELAY
  );
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startSSE();
  }, delay);
}

async function startSSE() {
  const config = await getConfig();
  if (!config || !config.token || !config.serverUrl) return;

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const base = config.serverUrl.replace(/\/$/, "");
  const url = `${base}/api/events/stream?token=${encodeURIComponent(config.token)}`;

  eventSource = new EventSource(url);

  eventSource.addEventListener("hello", (e) => {
    reconnectAttempts = 0;
    const data = JSON.parse(e.data);
    console.log("[LinkHop] SSE connected, device:", data.device_id);
    updateBadge("connected");
  });

  eventSource.addEventListener("message", async (e) => {
    const data = JSON.parse(e.data);
    const messageId = data.message_id;
    console.log("[LinkHop] New message:", messageId);

    // Write to storage for testability
    browser.storage.local.get("linkhop_test_received", (result) => {
      const ids = result.linkhop_test_received || [];
      ids.push(messageId);
      browser.storage.local.set({ linkhop_test_received: ids });
    });

    const message = await fetchMessage(config, messageId);
    if (!message) return;

    await markReceived(config, messageId);
    showNotification(messageId, message);
    await markPresented(config, messageId);
  });

  eventSource.addEventListener("ping", () => {
    // keepalive, nothing to do
  });

  eventSource.onerror = () => {
    console.log("[LinkHop] SSE error, reconnecting...");
    updateBadge("disconnected");
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    scheduleReconnect();
  };
}

function stopSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function updateBadge(state) {
  if (state === "connected") {
    browser.browserAction.setBadgeText({ text: "" });
  } else {
    browser.browserAction.setBadgeText({ text: "!" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#cc0000" });
  }
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

browser.contextMenus.create({
  id: "linkhop-send-page",
  title: "Send page via LinkHop",
  contexts: ["page"],
});

browser.contextMenus.create({
  id: "linkhop-send-link",
  title: "Send link via LinkHop",
  contexts: ["link"],
});

browser.contextMenus.create({
  id: "linkhop-send-selection",
  title: "Send selection via LinkHop",
  contexts: ["selection"],
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  const config = await getConfig();
  if (!config || !config.token || !config.defaultDeviceId) {
    // Open popup to set up
    browser.browserAction.openPopup();
    return;
  }

  let type, body;
  if (info.menuItemId === "linkhop-send-link") {
    type = "url";
    body = info.linkUrl;
  } else if (info.menuItemId === "linkhop-send-selection") {
    type = "text";
    body = info.selectionText;
  } else {
    type = "url";
    body = tab.url;
  }

  const resp = await apiFetch(config, "/api/messages", {
    method: "POST",
    body: JSON.stringify({
      recipient_device_id: config.defaultDeviceId,
      type,
      body,
    }),
  });

  if (resp.ok) {
    browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-48.svg"),
      title: "LinkHop",
      message: "Sent!",
    });
  }
});

// ---------------------------------------------------------------------------
// Message passing (from popup)
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "session_link" && msg.token && msg.serverUrl) {
    const config = {
      serverUrl: msg.serverUrl,
      token: msg.token,
      deviceId: msg.deviceId,
      deviceName: msg.deviceName,
      defaultDeviceId: null,
    };
    await saveConfig(config);
    reconnectAttempts = 0;
    await startSSE();
    return { ok: true };
  }
  if (msg.type === "linked") {
    // New credentials saved, start SSE
    reconnectAttempts = 0;
    await startSSE();
    return { ok: true };
  }
  if (msg.type === "unlinked") {
    stopSSE();
    updateBadge("disconnected");
    return { ok: true };
  }
  if (msg.type === "get_status") {
    return { connected: eventSource !== null && eventSource.readyState === EventSource.OPEN };
  }
});

// ---------------------------------------------------------------------------
// External messages (from the web UI)
// ---------------------------------------------------------------------------

browser.runtime.onMessageExternal.addListener(async (msg) => {
  if (msg.type === "session_link" && msg.token && msg.serverUrl) {
    const config = {
      serverUrl: msg.serverUrl,
      token: msg.token,
      deviceId: msg.deviceId,
      deviceName: msg.deviceName,
      defaultDeviceId: null,
    };
    await saveConfig(config);
    reconnectAttempts = 0;
    await startSSE();
    return { ok: true };
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

startSSE();
