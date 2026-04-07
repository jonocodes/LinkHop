/**
 * LinkHop Lite extension — persistent background page.
 *
 * Holds SSE connections to ntfy when the web app tab is closed.
 * When a msg.send arrives for our device, opens/focuses the app tab
 * so the web app can process, ack, and notify as normal.
 *
 * Pure logic lives in background-core.js (loaded first via background.html).
 */

/* global BackgroundCore */

const {
  DEFAULT_APP_URL,
  registryTopic,
  deviceTopic,
  parseSSEMessage,
  isMessageForDevice,
  getAppUrlPattern,
  extractConfig,
} = BackgroundCore;

const STORAGE_KEY = "linkhop_lite_config";

// --- State ---

let config = null;       // { device_id, network_id, env, ntfy_url, device_name }
let appUrl = DEFAULT_APP_URL;
let eventSources = [];   // active EventSource connections
let appTabId = null;      // tracked tab ID when app is open

// --- Storage ---

function loadStoredConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, "linkhop_lite_app_url"], (result) => {
      config = result[STORAGE_KEY] || null;
      appUrl = result.linkhop_lite_app_url || DEFAULT_APP_URL;
      resolve(config);
    });
  });
}

function saveConfig(cfg) {
  config = cfg;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: cfg }, resolve);
  });
}

function saveAppUrl(url) {
  appUrl = url;
  return new Promise((resolve) => {
    chrome.storage.local.set({ linkhop_lite_app_url: url }, resolve);
  });
}

function clearStoredConfig() {
  config = null;
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEY, resolve);
  });
}

// --- SSE ---

function connectSSE() {
  disconnectSSE();
  if (!config) return;

  const topics = [registryTopic(config), deviceTopic(config)];

  for (const topic of topics) {
    const url = `${config.ntfy_url}/${topic}/sse?since=30s`;
    const source = new EventSource(url);

    source.onmessage = (e) => {
      const event = parseSSEMessage(e.data);
      if (!event) return;

      if (isMessageForDevice(event, config.device_id)) {
        openOrFocusApp();
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects; nothing to do
    };

    eventSources.push(source);
  }

  console.log("[LinkHop] SSE watching:", topics.join(", "));
}

function disconnectSSE() {
  for (const source of eventSources) source.close();
  eventSources = [];
}

// --- Tab management ---

function findAppTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: getAppUrlPattern(appUrl) }, (tabs) => {
      resolve(tabs && tabs.length > 0 ? tabs[0] : null);
    });
  });
}

async function openOrFocusApp() {
  const tab = await findAppTab();
  if (tab) {
    chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      chrome.windows.update(tab.windowId, { focused: true });
    }
  } else {
    chrome.tabs.create({ url: appUrl });
  }
}

async function checkTabState() {
  const tab = await findAppTab();
  const tabIsOpen = !!tab;
  appTabId = tab ? tab.id : null;

  if (config) {
    if (tabIsOpen) {
      disconnectSSE();
    } else {
      if (eventSources.length === 0) {
        connectSSE();
      }
    }
  }
}

function injectContentScript(tabId) {
  chrome.tabs.executeScript(tabId, { file: "content_script.js" }, () => {
    if (chrome.runtime.lastError) {
      // Permission denied or tab not accessible — ignore
    }
  });
}

// --- Tab event listeners ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    const base = appUrl.replace(/\/+$/, "");
    if (tab.url.startsWith(base)) {
      injectContentScript(tabId);
      checkTabState();
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === appTabId) {
    appTabId = null;
    setTimeout(() => checkTabState(), 500);
  }
});

// --- Message handler (from content script and popup) ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "config_update" && msg.config) {
    const cfg = extractConfig(msg.config);
    if (!cfg) { sendResponse({ ok: false }); return true; }
    saveConfig(cfg).then(() => {
      checkTabState();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "config_cleared") {
    disconnectSSE();
    clearStoredConfig().then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "get_status") {
    findAppTab().then((tab) => {
      sendResponse({
        configured: !!config,
        device_name: config?.device_name || null,
        watching: eventSources.length > 0,
        tab_open: !!tab,
        app_url: appUrl,
      });
    });
    return true;
  }

  if (msg.type === "set_app_url") {
    saveAppUrl(msg.url).then(() => {
      checkTabState();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "open_app") {
    openOrFocusApp().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "disconnect") {
    disconnectSSE();
    clearStoredConfig().then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "reconnect") {
    openOrFocusApp().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// --- Init ---

loadStoredConfig().then(() => {
  checkTabState();
});
