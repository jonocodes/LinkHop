// Chrome/Firefox compatibility shim
const browser = globalThis.browser || globalThis.chrome;

const STORAGE_KEY = "linkhop_config";

// ---------------------------------------------------------------------------
// Storage
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

async function clearConfig() {
  return new Promise((resolve) => {
    browser.storage.local.remove(STORAGE_KEY, resolve);
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


async function fetchDevices(config) {
  const resp = await apiFetch(config, "/api/devices");
  if (!resp.ok) return [];
  return resp.json();
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function show(id) { document.getElementById(id).classList.remove("hidden"); }
function hide(id) { document.getElementById(id).classList.add("hidden"); }
function setError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  msg ? el.classList.remove("hidden") : el.classList.add("hidden");
}

function setStatusDot(state) {
  const dot = document.getElementById("status-dot");
  dot.className = "dot";
  if (state === "ok") dot.classList.add("dot-ok");
  else if (state === "error") dot.classList.add("dot-error");
  else dot.classList.add("dot-unknown");
}

// ---------------------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------------------

async function initSetupScreen() {
  show("screen-setup");
  hide("screen-main");

  document.getElementById("btn-link").addEventListener("click", () => {
    const serverUrl = document.getElementById("server-url").value.trim();
    if (!serverUrl) return setError("setup-error", "Server URL is required.");
    const url = `${serverUrl.replace(/\/$/, "")}/account/connected-devices/`;
    browser.tabs.create({ url });
    window.close();
  });
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

async function initMainScreen(config) {
  hide("screen-setup");
  show("screen-main");

  // Check SSE connection status from background
  try {
    const status = await browser.runtime.sendMessage({ type: "get_status" });
    updateConnectionUI(status.connected);
  } catch (_) {
    updateConnectionUI(false);
  }

  // Load devices
  const devices = await fetchDevices(config);
  const select = document.getElementById("device-select");
  select.innerHTML = '<option value="">— select device —</option>';
  devices.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name + (d.is_online ? " 🟢" : "");
    opt.selected = d.id === config.defaultDeviceId;
    select.appendChild(opt);
  });

  // Pre-fill current tab URL
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const body = document.getElementById("send-body");
  if (tab && tab.url) {
    body.value = tab.url;
  }

  // Type toggle
  document.querySelectorAll('input[name="send-type"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.value === "url" && tab) body.value = tab.url || "";
      else if (radio.value === "text") body.value = "";
    });
  });

  // Send
  document.getElementById("btn-send").addEventListener("click", async () => {
    const deviceId = select.value;
    if (!deviceId) return showFeedback("Select a device first.", false);

    const type = document.querySelector('input[name="send-type"]:checked').value;
    const sendBody = body.value.trim();
    if (!sendBody) return showFeedback("Nothing to send.", false);

    // Save last used device
    config.defaultDeviceId = deviceId;
    await saveConfig(config);

    const btn = document.getElementById("btn-send");
    btn.disabled = true;
    btn.textContent = "Sending…";

    try {
      const resp = await apiFetch(config, "/api/messages", {
        method: "POST",
        body: JSON.stringify({
          recipient_device_id: deviceId,
          type,
          body: sendBody,
        }),
      });

      if (resp.ok) {
        showFeedback("Sent!", true);
        setTimeout(() => window.close(), 1200);
      } else {
        const data = await resp.json().catch(() => ({}));
        showFeedback(data?.error?.message || `Failed (${resp.status})`, false);
      }
    } catch (err) {
      showFeedback(`Error: ${err.message}`, false);
    } finally {
      btn.disabled = false;
      btn.textContent = "Send";
    }
  });

  // Unlink
  document.getElementById("btn-unlink").addEventListener("click", async () => {
    if (!confirm("Unlink this device? You will need to pair again.")) return;
    await clearConfig();
    browser.runtime.sendMessage({ type: "unlinked" });
    initSetupScreen();
  });
}

function updateConnectionUI(connected) {
  const bar = document.getElementById("connection-status");
  const text = document.getElementById("status-text");
  setStatusDot(connected ? "ok" : "error");
  bar.className = "status-bar " + (connected ? "connected" : "disconnected");
  text.textContent = connected ? "Connected" : "Disconnected — reconnecting…";
}

function showFeedback(msg, ok) {
  const el = document.getElementById("send-feedback");
  el.textContent = msg;
  el.className = "feedback " + (ok ? "ok" : "err");
  el.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async () => {
  const config = await getConfig();
  if (config && config.token) {
    await initMainScreen(config);
  } else {
    await initSetupScreen();
  }
})();
