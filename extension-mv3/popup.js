const STORAGE_KEY = "linkhop_config";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => resolve(result[STORAGE_KEY] || null));
  });
}

async function saveConfig(config) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: config }, resolve);
  });
}

async function clearConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEY, resolve);
  });
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch(config, path, options = {}) {
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

function showFeedback(msg, ok) {
  const el = document.getElementById("send-feedback");
  el.textContent = msg;
  el.className = "feedback " + (ok ? "ok" : "err");
  el.classList.remove("hidden");
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
    const url = `${serverUrl.replace(/\/$/, "")}/account/inbox/`;
    chrome.tabs.create({ url });
    window.close();
  });
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

async function initMainScreen(config) {
  hide("screen-setup");
  show("screen-main");

  // Push status
  try {
    const status = await chrome.runtime.sendMessage({ type: "get_status" });
    updatePushUI(status.pushEnabled);
  } catch (_) {
    updatePushUI(false);
  }

  // Enable push button — opens a dedicated page to avoid popup-closes-on-focus-loss
  document.getElementById("btn-enable-push").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("grant-permission.html") });
    window.close();
  });

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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const body = document.getElementById("send-body");
  if (tab?.url) body.value = tab.url;

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

    config.defaultDeviceId = deviceId;
    await saveConfig(config);

    const btn = document.getElementById("btn-send");
    btn.disabled = true;
    btn.textContent = "Sending…";

    try {
      const resp = await apiFetch(config, "/api/messages", {
        method: "POST",
        body: JSON.stringify({ recipient_device_id: deviceId, type, body: sendBody }),
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
    if (!confirm("Unlink this device? You will need to reconnect.")) return;
    await chrome.runtime.sendMessage({ type: "unlinked" });
    initSetupScreen();
  });
}

function updatePushUI(enabled) {
  const bar = document.getElementById("connection-status");
  const text = document.getElementById("status-text");
  const btn = document.getElementById("btn-enable-push");
  const dot = document.getElementById("status-dot");

  if (enabled) {
    dot.className = "dot dot-ok";
    bar.className = "status-bar connected";
    text.textContent = "Push notifications enabled";
    btn.style.display = "none";
  } else {
    dot.className = "dot dot-error";
    bar.className = "status-bar disconnected";
    text.textContent = "Notifications disabled";
    btn.style.display = "";
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async () => {
  const config = await getConfig();
  if (config?.token) {
    await initMainScreen(config);
  } else {
    await initSetupScreen();
  }
})();
