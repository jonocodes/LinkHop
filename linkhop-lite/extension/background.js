/**
 * LinkHop Lite extension — persistent background page.
 *
 * Holds SSE connections to ntfy when the web app tab is closed.
 * When a msg.send arrives for our device, opens/focuses the app tab
 * so the web app can process, ack, and notify as normal.
 */

const STORAGE_KEY = "linkhop_lite_config";
const DEFAULT_APP_URL = "https://jonocodes.github.io/LinkHop/";

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

// --- Topic helpers ---

function registryTopic(cfg) {
  return `linkhop-${cfg.env}-${cfg.network_id}-registry`;
}

function deviceTopic(cfg) {
  return `linkhop-${cfg.env}-${cfg.network_id}-device-${cfg.device_id}`;
}

// --- SSE ---

function parseSSEMessage(data) {
  try {
    const parsed = JSON.parse(data);
    // ntfy SSE wraps the payload: { event: "message", message: "<json string>" }
    if (parsed.event === "message" && typeof parsed.message === "string") {
      try { return JSON.parse(parsed.message); } catch { return null; }
    }
    // Direct protocol event
    if (parsed.type && parsed.event_id) return parsed;
  } catch { /* not JSON */ }
  return null;
}

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

      // We only care about messages addressed to us
      if (event.type === "msg.send" && event.payload?.to_device_id === config.device_id) {
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

function getAppUrlPattern() {
  // Match the app URL and any subpaths
  const base = appUrl.replace(/\/+$/, "");
  return base + "*";
}

function findAppTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: getAppUrlPattern() }, (tabs) => {
      resolve(tabs && tabs.length > 0 ? tabs[0] : null);
    });
  });
}

async function openOrFocusApp() {
  const tab = await findAppTab();
  if (tab) {
    // Tab exists — focus it
    chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      chrome.windows.update(tab.windowId, { focused: true });
    }
  } else {
    // Open new tab
    chrome.tabs.create({ url: appUrl });
  }
}

async function checkTabState() {
  const tab = await findAppTab();
  const tabIsOpen = !!tab;
  appTabId = tab ? tab.id : null;

  if (config) {
    if (tabIsOpen) {
      // App tab is open — go idle, let the web app handle everything
      disconnectSSE();
    } else {
      // App tab is closed — start watching
      if (eventSources.length === 0) {
        connectSSE();
      }
    }
  }
}

// Inject the content script when an app tab loads to grab config
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
    const pattern = appUrl.replace(/\/+$/, "");
    if (tab.url.startsWith(pattern)) {
      injectContentScript(tabId);
      checkTabState();
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === appTabId) {
    appTabId = null;
    // Tab closed — start watching after a short delay to let the tab fully close
    setTimeout(() => checkTabState(), 500);
  }
});

// --- Message handler (from content script and popup) ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "config_update" && msg.config) {
    // Content script read config from the web app's IndexedDB
    const cfg = {
      device_id: msg.config.device.device_id,
      device_name: msg.config.device.device_name,
      network_id: msg.config.device.network_id,
      env: msg.config.device.env,
      ntfy_url: msg.config.ntfy_url,
    };
    saveConfig(cfg).then(() => {
      checkTabState();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "config_cleared") {
    // User left the network in the web app
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
    // Re-read config by opening the app tab briefly
    openOrFocusApp().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// --- Init ---

loadStoredConfig().then(() => {
  checkTabState();
});
