import { App, type AppScreen, type ConnectionStatus } from "./app.js";
import { getDevices, getInbox, getPending } from "../../src/engine/state.js";

let app: App;
let currentTab: "devices" | "inbox" | "pending" = "devices";

export function mount(root: HTMLElement): void {
  app = new App({
    onStateChange: () => renderMainContent(),
    onScreenChange: (screen) => showScreen(screen),
    onConnectionChange: (status) => renderStatus(status),
    onError: (msg) => showError(msg),
  });

  root.innerHTML = `
    ${renderSetupScreen()}
    ${renderMainScreen()}
  `;

  bindSetupEvents();
  app.init();
}

function renderSetupScreen(): string {
  return `
    <div id="screen-setup" class="screen">
      <h1>LinkHop Lite</h1>
      <div class="form-group">
        <label for="setup-name">Device name</label>
        <input id="setup-name" type="text" placeholder="My Phone" />
      </div>
      <div class="form-group">
        <label for="setup-password">Network password</label>
        <input id="setup-password" type="password" placeholder="shared secret" />
      </div>
      <div class="form-group">
        <label for="setup-ntfy">ntfy server</label>
        <input id="setup-ntfy" type="url" value="http://localhost:8080" />
      </div>
      <button id="setup-btn">Join network</button>
    </div>
  `;
}

function renderMainScreen(): string {
  return `
    <div id="screen-main" class="screen">
      <div id="status-bar" class="status-bar">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-text">Disconnected</span>
      </div>

      <div class="tab-bar">
        <button class="active" data-tab="devices">Devices</button>
        <button data-tab="inbox">Inbox</button>
        <button data-tab="pending">Pending</button>
      </div>

      <div id="main-content"></div>

      <div class="send-form" id="send-form" style="display:none">
        <select id="send-target"></select>
        <input id="send-text" type="text" placeholder="Message..." />
        <button id="send-btn">Send</button>
      </div>
    </div>
  `;
}

function bindSetupEvents(): void {
  document.getElementById("setup-btn")!.addEventListener("click", async () => {
    const name = (document.getElementById("setup-name") as HTMLInputElement).value.trim();
    const password = (document.getElementById("setup-password") as HTMLInputElement).value;
    const ntfyUrl = (document.getElementById("setup-ntfy") as HTMLInputElement).value.trim();

    if (!name || !password) {
      showError("Name and password are required");
      return;
    }

    const btn = document.getElementById("setup-btn") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Joining...";

    try {
      await app.setup(name, password, ntfyUrl);
    } catch (err) {
      showError(`Setup failed: ${err}`);
      btn.disabled = false;
      btn.textContent = "Join network";
    }
  });
}

function bindMainEvents(): void {
  // Tab switching
  document.querySelectorAll(".tab-bar button").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTab = (btn as HTMLElement).dataset.tab as typeof currentTab;
      document.querySelectorAll(".tab-bar button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderMainContent();

      const sendForm = document.getElementById("send-form")!;
      sendForm.style.display = currentTab === "inbox" ? "flex" : "none";
    });
  });

  // Send
  document.getElementById("send-btn")!.addEventListener("click", async () => {
    const target = (document.getElementById("send-target") as HTMLSelectElement).value;
    const input = document.getElementById("send-text") as HTMLInputElement;
    const text = input.value.trim();
    if (!target || !text) return;

    await app.send(target, text);
    input.value = "";
  });

  // Enter to send
  document.getElementById("send-text")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      document.getElementById("send-btn")!.click();
    }
  });
}

function showScreen(screen: AppScreen): void {
  document.getElementById("screen-setup")!.classList.toggle("active", screen === "setup");
  document.getElementById("screen-main")!.classList.toggle("active", screen === "main");

  if (screen === "main") {
    bindMainEvents();
    renderMainContent();
  }
}

function renderStatus(status: ConnectionStatus): void {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  if (!dot || !text) return;

  dot.className = `status-dot ${status === "connected" ? "connected" : ""}`;

  const label = status === "connected" ? "Connected" : status === "connecting" ? "Connecting..." : "Disconnected";
  const deviceInfo = app.config ? ` \u00b7 ${app.config.device_name}` : "";
  text.textContent = label + deviceInfo;
}

function renderMainContent(): void {
  const container = document.getElementById("main-content");
  if (!container) return;

  switch (currentTab) {
    case "devices":
      container.innerHTML = renderDevices();
      break;
    case "inbox":
      container.innerHTML = renderInbox();
      updateSendTargets();
      document.getElementById("send-form")!.style.display = "flex";
      break;
    case "pending":
      container.innerHTML = renderPending();
      document.getElementById("send-form")!.style.display = "none";
      break;
  }
}

function renderDevices(): string {
  const devices = getDevices(app.state);
  if (devices.length === 0) {
    return `<div class="empty-state">No devices discovered yet</div>`;
  }

  return devices
    .map((d) => {
      const isSelf = d.device_id === app.config?.device_id;
      const badgeClass = isSelf ? "badge self" : d.is_removed ? "badge removed" : "badge";
      const badgeText = isSelf ? "you" : d.is_removed ? "left" : "active";
      return `
        <div class="device-item">
          <div>
            <div class="name">${esc(d.device_name)}</div>
            <div class="meta">${esc(d.device_id)}</div>
          </div>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
      `;
    })
    .join("");
}

function renderInbox(): string {
  if (!app.config) return "";
  const inbox = getInbox(app.state, app.config.device_id);
  if (inbox.length === 0) {
    return `<div class="empty-state">No messages yet</div>`;
  }

  return inbox
    .map((m) => {
      const from = app.state.devices.get(m.from_device_id);
      const fromLabel = from ? from.device_name : m.from_device_id;
      return `
        <div class="msg-item received">
          <div class="msg-from">From ${esc(fromLabel)}</div>
          <div class="msg-body">${esc(m.body.text)}</div>
          <div class="msg-time">${formatTime(m.created_at)}</div>
        </div>
      `;
    })
    .join("");
}

function renderPending(): string {
  if (!app.config) return "";
  const pending = getPending(app.state, app.config.device_id);
  if (pending.length === 0) {
    return `<div class="empty-state">No pending messages</div>`;
  }

  return pending
    .map((m) => {
      const to = app.state.devices.get(m.to_device_id);
      const toLabel = to ? to.device_name : m.to_device_id;
      return `
        <div class="msg-item pending">
          <div class="msg-from">To ${esc(toLabel)}</div>
          <div class="msg-body">${esc(m.body.text)}</div>
          <div class="msg-time">${formatTime(m.created_at)} \u00b7 attempt ${m.last_attempt_id}</div>
        </div>
      `;
    })
    .join("");
}

function updateSendTargets(): void {
  const select = document.getElementById("send-target") as HTMLSelectElement;
  if (!select) return;

  const devices = getDevices(app.state).filter(
    (d) => d.device_id !== app.config?.device_id && !d.is_removed,
  );

  const currentValue = select.value;
  select.innerHTML =
    `<option value="">Select device...</option>` +
    devices
      .map((d) => `<option value="${esc(d.device_id)}">${esc(d.device_name)}</option>`)
      .join("");

  if (currentValue && devices.some((d) => d.device_id === currentValue)) {
    select.value = currentValue;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function esc(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function showError(msg: string): void {
  console.error(msg);
  // Simple inline error - could be a toast later
  const existing = document.querySelector(".error-toast");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = "error-toast";
  el.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);" +
    "background:#e94560;color:white;padding:10px 20px;border-radius:8px;" +
    "font-size:0.9rem;z-index:100;";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
