import { App, type AppScreen, type ConnectionStatus } from "./app.js";
import { getDevices, getInbox, getPending, getSent, getUnreadCount } from "../../src/engine/state.js";
import { registryTopicFromConfig, deviceTopicFromConfig } from "../../src/protocol/topics.js";
import type { MessageBody } from "../../src/protocol/types.js";

declare const __BUILD_TIME__: string;

let app: App;
let currentTab: "devices" | "inbox" | "pending" | "settings" = "devices";
let currentMessageId: string | null = null;
let pendingOpenMsgId: string | null = null;
let pendingShareUrl: string | null = null;
let pendingShareTitle: string | null = null;
let pendingShareText: string | null = null;
let sendMode: "text" | "url" = "text";
let showDebug = false;

export function mount(root: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);

  // Check if opened from a background notification with a msg param
  const urlMsg = params.get("msg");
  if (urlMsg) {
    pendingOpenMsgId = urlMsg;
  }

  // Check if opened from Web Share Target
  const shareUrl = params.get("share-url");
  const shareText = params.get("share-text");
  if (shareUrl) {
    pendingShareUrl = shareUrl;
    pendingShareTitle = params.get("share-title");
  } else if (shareText) {
    pendingShareText = shareText;
  }

  if (urlMsg || shareUrl || shareText) {
    history.replaceState(null, "", "/");
  }

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

  // Listen for messages from the service worker (notification clicks)
  navigator.serviceWorker?.addEventListener("message", (event) => {
    const { type, msg_id } = event.data ?? {};
    if (type === "open-message" && msg_id) {
      openMessageById(msg_id as string);
    } else if (type === "mark-viewed" && msg_id) {
      app.markMessageViewed(msg_id as string);
    }
  });

  app.init();
}

function openMessageById(msgId: string): void {
  currentTab = "inbox";
  currentMessageId = msgId;
  document.querySelectorAll(".tab-bar button[data-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelector('.tab-bar button[data-tab="inbox"]')?.classList.add("active");
  app.markMessageViewed(msgId);
}

function prefillShareData(url: string, _title: string | null): void {
  currentTab = "inbox";
  currentMessageId = null;
  document.querySelectorAll(".tab-bar button[data-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelector('.tab-bar button[data-tab="inbox"]')?.classList.add("active");
  renderMainContent();
  const input = document.getElementById("send-text") as HTMLInputElement | null;
  const toggle = document.getElementById("send-mode-toggle");
  if (input && toggle) {
    sendMode = "url";
    input.value = url;
    input.placeholder = "Paste a URL...";
    toggle.textContent = "Link";
    toggle.classList.add("active");
    input.focus();
  }
}

function prefillShareText(text: string): void {
  currentTab = "inbox";
  currentMessageId = null;
  document.querySelectorAll(".tab-bar button[data-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelector('.tab-bar button[data-tab="inbox"]')?.classList.add("active");
  renderMainContent();
  const input = document.getElementById("send-text") as HTMLInputElement | null;
  if (input) {
    sendMode = "text";
    input.value = text;
    input.focus();
  }
}

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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
        <label for="setup-pool">Pool name</label>
        <input id="setup-pool" type="text" placeholder="my-family" />
      </div>
      <div class="form-group">
        <label for="setup-password">Password</label>
        <input id="setup-password" type="password" placeholder="shared secret" />
      </div>
      <button id="setup-btn">Join network</button>
      <button class="secondary setup-settings-link" id="setup-settings-btn" type="button">Settings</button>
    </div>
  `;
}

function renderMainScreen(): string {
  return `
    <div id="screen-main" class="screen">
      <div id="status-bar" class="status-bar">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-text">Disconnected</span>
        <span class="status-spacer"></span>
      </div>

      <div id="offline-banner" class="offline-banner" style="display:none">
        Connection lost. Reconnecting...
      </div>

      <div class="tab-bar">
        <button class="active" data-tab="devices">Devices</button>
        <button data-tab="inbox">Inbox</button>
        <button data-tab="pending">Pending</button>
        <button data-tab="settings">Settings</button>
      </div>

      <div id="main-content"></div>

      <div class="send-form" id="send-form" style="display:none">
        <div class="send-top-row">
          <select id="send-target"></select>
          <button id="send-mode-toggle" class="send-mode-btn" title="Switch between text and link mode">Text</button>
        </div>
        <div class="send-row">
          <input id="send-text" type="text" placeholder="Message..." />
          <button id="send-btn">Send</button>
        </div>
      </div>
    </div>
  `;
}

function bindSetupEvents(): void {
  document.getElementById("setup-btn")!.addEventListener("click", async () => {
    const name = (document.getElementById("setup-name") as HTMLInputElement).value.trim();
    const pool = (document.getElementById("setup-pool") as HTMLInputElement).value.trim();
    const password = (document.getElementById("setup-password") as HTMLInputElement).value;
    const serverInput = document.getElementById("setup-settings-server") as HTMLInputElement | null;
    const ntfyUrl = serverInput?.value.trim() || "https://ntfy.sh";

    if (!name || !pool || !password) {
      showError("Name, pool, and password are required");
      return;
    }

    const btn = document.getElementById("setup-btn") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Joining...";

    try {
      await app.setup(name, pool, password, ntfyUrl);
    } catch (err) {
      showError(`Setup failed: ${err}`);
      btn.disabled = false;
      btn.textContent = "Join network";
    }
  });

  document.getElementById("setup-settings-btn")!.addEventListener("click", () => {
    const setupForm = document.getElementById("screen-setup")!;
    const settingsPanel = document.getElementById("setup-settings-panel");

    if (settingsPanel) {
      settingsPanel.remove();
      return;
    }

    const existingUrl = (document.getElementById("setup-settings-server") as HTMLInputElement | null)?.value || "https://ntfy.sh";
    const panel = document.createElement("div");
    panel.id = "setup-settings-panel";
    panel.className = "settings-panel";
    panel.innerHTML = `
      <div class="settings-section">
        <div class="settings-label">Server</div>
        <div class="settings-row">
          <input id="setup-settings-server" type="url" value="${existingUrl}" />
        </div>
        <div class="settings-hint">Change the ntfy server URL used for messaging</div>
      </div>
    `;
    setupForm.appendChild(panel);
  });
}

function bindMainEvents(): void {
  // Tab switching
  document.querySelectorAll(".tab-bar button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTab = (btn as HTMLElement).dataset.tab as typeof currentTab;
      currentMessageId = null;
      document.querySelectorAll(".tab-bar button[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderMainContent();
      updateSendFormVisibility();
    });
  });

  // Mode toggle: switch between Text and Link
  document.getElementById("send-mode-toggle")!.addEventListener("click", () => {
    sendMode = sendMode === "text" ? "url" : "text";
    const input = document.getElementById("send-text") as HTMLInputElement;
    const toggle = document.getElementById("send-mode-toggle")!;
    input.value = "";
    if (sendMode === "url") {
      input.placeholder = "Paste a URL...";
      toggle.textContent = "Link";
      toggle.classList.add("active");
    } else {
      input.placeholder = "Message...";
      toggle.textContent = "Text";
      toggle.classList.remove("active");
    }
    input.focus();
  });

  // Send
  document.getElementById("send-btn")!.addEventListener("click", async () => {
    const target = (document.getElementById("send-target") as HTMLSelectElement).value;
    const input = document.getElementById("send-text") as HTMLInputElement;
    const text = input.value.trim();
    if (!target || !text) return;

    if (sendMode === "url") {
      if (!isUrl(text)) { showError("That doesn't look like a valid URL"); return; }
      await app.sendUrl(target, text);
    } else {
      await app.send(target, text);
    }
    input.value = "";
    // Reset to text mode after sending
    sendMode = "text";
    input.placeholder = "Message...";
    const toggle = document.getElementById("send-mode-toggle")!;
    toggle.textContent = "Text";
    toggle.classList.remove("active");
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
    if (pendingOpenMsgId) {
      const msgId = pendingOpenMsgId;
      pendingOpenMsgId = null;
      openMessageById(msgId);
    } else {
      renderMainContent();
    }
    if (pendingShareUrl) {
      const shareUrl = pendingShareUrl;
      const shareTitle = pendingShareTitle;
      pendingShareUrl = null;
      pendingShareTitle = null;
      prefillShareData(shareUrl, shareTitle);
    } else if (pendingShareText) {
      const shareText = pendingShareText;
      pendingShareText = null;
      prefillShareText(shareText);
    }
  }
}

function renderStatus(status: ConnectionStatus): void {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const banner = document.getElementById("offline-banner");
  if (!dot || !text) return;

  dot.className = `status-dot ${status === "connected" ? "connected" : status === "connecting" ? "connecting" : ""}`;

  const label = status === "connected" ? "Connected" : status === "connecting" ? "Reconnecting..." : "Disconnected";
  const poolSuffix = app.pool ? ` @ ${app.pool}` : "";
  const deviceInfo = app.config ? ` \u00b7 ${app.config.device_name}${poolSuffix}` : "";
  text.textContent = label + deviceInfo;

  if (banner) {
    banner.style.display = status === "connecting" ? "block" : "none";
  }
}


function updateSendFormVisibility(): void {
  const sendForm = document.getElementById("send-form");
  if (sendForm) {
    sendForm.style.display = currentTab === "inbox" ? "flex" : "none";
  }
}

function renderMainContent(): void {
  const container = document.getElementById("main-content");
  if (!container) return;

  renderTabBar();

  switch (currentTab) {
    case "devices":
      container.innerHTML = renderDevices();
      container.querySelectorAll<HTMLElement>(".device-item-clickable").forEach((el) => {
        el.addEventListener("click", () => {
          const deviceId = el.dataset.deviceId;
          if (deviceId) switchToInbox(deviceId);
        });
      });
      break;
    case "inbox":
      if (currentMessageId) {
        container.innerHTML = renderMessageDetail(currentMessageId);
        container.querySelector<HTMLElement>("#msg-detail-back")?.addEventListener("click", () => {
          currentMessageId = null;
          renderMainContent();
        });
        container.querySelector<HTMLElement>(".msg-dismiss")?.addEventListener("click", async () => {
          const msgId = currentMessageId;
          currentMessageId = null;
          if (msgId) await app.dismissMessage(msgId);
        });
      } else {
        container.innerHTML = renderInbox();
        container.querySelectorAll<HTMLElement>(".msg-item-clickable").forEach((el) => {
          el.addEventListener("click", async (e) => {
            if ((e.target as HTMLElement).closest(".msg-dismiss")) return;
            const msgId = el.dataset.msgId;
            if (msgId) {
              currentMessageId = msgId;
              await app.markMessageViewed(msgId);
            }
          });
        });
        container.querySelectorAll<HTMLElement>(".msg-dismiss").forEach((btn) => {
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const msgId = btn.dataset.msgId;
            if (msgId) await app.dismissMessage(msgId);
          });
        });
        updateSendTargets();
      }
      updateSendFormVisibility();
      break;
    case "pending":
      container.innerHTML = renderPending();
      updateSendFormVisibility();
      break;
    case "settings":
      container.innerHTML = showDebug ? renderDebug() : renderSettings();
      bindSettingsEvents();
      updateSendFormVisibility();
      break;
  }
}

function renderTabBar(): void {
  const unread = app.config ? getUnreadCount(app.state, app.config.device_id) : 0;
  const inboxBtn = document.querySelector<HTMLElement>('.tab-bar button[data-tab="inbox"]');
  if (inboxBtn) {
    const badge = unread > 0 && currentTab !== "inbox"
      ? ` <span class="tab-badge">${unread}</span>`
      : "";
    inboxBtn.innerHTML = `Inbox${badge}`;
  }
}

function switchToInbox(deviceId: string): void {
  currentTab = "inbox";
  document.querySelectorAll(".tab-bar button[data-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelector(`.tab-bar button[data-tab="inbox"]`)?.classList.add("active");
  renderMainContent();
  const select = document.getElementById("send-target") as HTMLSelectElement | null;
  if (select) select.value = deviceId;
}

function renderDevices(): string {
  const devices = getDevices(app.state);
  if (devices.length === 0) {
    return `<div class="empty-state">No devices discovered yet.<br>Other devices on the same network will appear here.</div>`;
  }

  return [...devices]
    .sort((a, b) => Number(a.is_removed) - Number(b.is_removed))
    .map((d) => {
      const isSelf = d.device_id === app.config?.device_id;
      const isClickable = !isSelf && !d.is_removed;
      const badgeClass = isSelf ? "badge self" : d.is_removed ? "badge removed" : "badge";
      const badgeText = isSelf ? "you" : d.is_removed ? "left" : "active";
      const encryptionActive = app.encryptionEnabled && app.encryptionKey !== null && d.capabilities?.includes("encryption");
      return `
        <div class="device-item${isClickable ? " device-item-clickable" : ""}${d.is_removed ? " device-item-removed" : ""}"${isClickable ? ` data-device-id="${esc(d.device_id)}"` : ""}>
          <div>
            <div class="name">${esc(d.device_name)}${encryptionActive ? ' <span class="capability-badge">encrypted</span>' : ""}</div>
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
    return `<div class="empty-state">No messages yet.<br>Send one using the form below.</div>`;
  }

  return [...inbox]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((m) => {
      const from = app.state.devices.get(m.from_device_id);
      const fromLabel = from ? from.device_name : m.from_device_id;
      const bodyHtml = renderMessageBody(m.body);
      const isUnread = m.state === "received";
      const stateClass = isUnread ? "received" : "viewed";
      const stateBadge = isUnread
        ? `<span class="msg-state-badge new">New</span>`
        : `<span class="msg-state-badge viewed">Viewed</span>`;
      return `
        <div class="msg-item ${stateClass} msg-item-clickable" data-msg-id="${esc(m.msg_id)}">
          <div class="msg-item-header">
            <span class="msg-from">From ${esc(fromLabel)}</span>
            <div class="msg-item-actions">
              ${stateBadge}
              <button class="msg-dismiss" data-msg-id="${esc(m.msg_id)}" title="Dismiss">&times;</button>
            </div>
          </div>
          <div class="msg-body">${bodyHtml}</div>
          <div class="msg-time">${formatTime(m.created_at)}</div>
        </div>
      `;
    })
    .join("");
}

function renderMessageDetail(msgId: string): string {
  if (!app.config) return "";
  const m = app.state.messages.get(msgId);
  if (!m) {
    return `
      <button class="secondary" id="msg-detail-back" style="margin-bottom:12px">&larr; Back</button>
      <div class="empty-state">Message not found.</div>
    `;
  }
  const from = app.state.devices.get(m.from_device_id);
  const fromLabel = from ? from.device_name : m.from_device_id;
  const bodyHtml = renderMessageBody(m.body);
  const stateLabel = m.state === "received" ? "New" : "Viewed";
  const stateClass = m.state === "received" ? "new" : "viewed";
  const viewedLine = m.viewed_at
    ? `<div class="msg-detail-meta">Viewed ${formatTime(m.viewed_at)}</div>`
    : "";
  return `
    <button class="secondary" id="msg-detail-back" style="margin-bottom:12px">&larr; Back to Inbox</button>
    <div class="msg-detail">
      <div class="msg-detail-header">
        <div class="msg-detail-from">From ${esc(fromLabel)}</div>
        <span class="msg-state-badge ${stateClass}">${stateLabel}</span>
      </div>
      <div class="msg-detail-body">${bodyHtml}</div>
      <div class="msg-detail-meta">Received ${formatTime(m.created_at)}</div>
      ${viewedLine}
      <button class="msg-dismiss secondary" data-msg-id="${esc(m.msg_id)}" style="margin-top:16px">Dismiss message</button>
    </div>
  `;
}

function renderPending(): string {
  if (!app.config) return "";
  const pending = getPending(app.state, app.config.device_id);
  const sent = getSent(app.state, app.config.device_id);

  const renderMsg = (m: (typeof pending)[0], isPending: boolean): string => {
    const to = app.state.devices.get(m.to_device_id);
    const toLabel = to ? to.device_name : m.to_device_id;
    const bodyHtml = renderMessageBody(m.body);
    const timeStr = isPending
      ? `${formatTime(m.created_at)} \u00b7 attempt ${m.last_attempt_id}`
      : formatTime(m.created_at);
    return `
      <div class="msg-item ${isPending ? "pending" : "received"}">
        <div class="msg-from">To ${esc(toLabel)}</div>
        <div class="msg-body">${bodyHtml}</div>
        <div class="msg-time">${timeStr}</div>
      </div>
    `;
  };

  const pendingSection = pending.length === 0
    ? `<div class="empty-state" style="font-size:0.85rem">No pending messages.</div>`
    : [...pending]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((m) => renderMsg(m, true))
        .join("");

  const sentSection = sent.length === 0
    ? `<div class="empty-state" style="font-size:0.85rem">No sent messages.</div>`
    : [...sent]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((m) => renderMsg(m, false))
        .join("");

  return `
    <div class="section-header">Pending</div>
    ${pendingSection}
    <div class="section-header">Sent</div>
    ${sentSection}
  `;
}

function updateSendTargets(): void {
  const select = document.getElementById("send-target") as HTMLSelectElement;
  if (!select) return;

  const devices = getDevices(app.state).filter(
    (d) => (app.selfSendEnabled || d.device_id !== app.config?.device_id) && !d.is_removed,
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

function renderMessageBody(body: MessageBody): string {
  if (body.kind === "text") {
    return esc(body.text);
  }
  if (body.kind === "url") {
    const safe = isUrl(body.url) ? body.url : "#";
    const inner = body.title
      ? `<div class="url-card-title">${esc(body.title)}</div><div class="url-card-url">${esc(body.url)}</div>`
      : `<div class="url-card-url">${esc(body.url)}</div>`;
    return `<a class="url-card" href="${safe}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  }
  return `<span class="encrypted-msg">Encrypted message — cannot decrypt</span>`;
}

function renderSettings(): string {
  const on = app.encryptionEnabled && app.encryptionKey !== null;
  const hasKey = app.encryptionKey !== null;

  return `
    <div class="settings-section">
      <div class="settings-label">Encryption</div>
      <div class="settings-row">
        <span>${on ? "Encrypted" : "Plaintext"}</span>
        <button class="settings-toggle ${on ? "on" : ""}" id="settings-encrypt-toggle"
          ${!hasKey ? "disabled" : ""}>${on ? "On" : "Off"}</button>
      </div>
      ${!hasKey ? '<div class="settings-hint">No encryption key (joined without password)</div>' : ""}
    </div>

    <div class="settings-section">
      <div class="settings-label">Self-send</div>
      <div class="settings-row">
        <span>${app.selfSendEnabled ? "Enabled" : "Disabled"}</span>
        <button class="settings-toggle ${app.selfSendEnabled ? "on" : ""}" id="settings-selfsend-toggle">${app.selfSendEnabled ? "On" : "Off"}</button>
      </div>
      <div class="settings-hint">Send messages to yourself through the relay (useful for testing)</div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Server</div>
      <div class="settings-hint">${esc(app.ntfyUrl)}</div>
    </div>

    <div class="settings-section">
      <button class="secondary" id="settings-debug-btn">View Debug Info</button>
    </div>

    <div class="settings-section">
      <button class="secondary settings-leave" id="settings-leave-btn">Leave Network</button>
    </div>
  `;
}

function bindSettingsEvents(): void {
  const encToggle = document.getElementById("settings-encrypt-toggle");
  if (encToggle) {
    encToggle.addEventListener("click", async () => {
      await app.toggleEncryption();
      renderMainContent();
    });
  }

  const selfSendToggle = document.getElementById("settings-selfsend-toggle");
  if (selfSendToggle) {
    selfSendToggle.addEventListener("click", async () => {
      await app.toggleSelfSend();
      renderMainContent();
    });
  }

  const debugBtn = document.getElementById("settings-debug-btn");
  if (debugBtn) {
    debugBtn.addEventListener("click", () => {
      showDebug = true;
      renderMainContent();
    });
  }

  const backBtn = document.getElementById("debug-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      showDebug = false;
      renderMainContent();
    });
  }

  const leaveBtn = document.getElementById("settings-leave-btn");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", async () => {
      if (!confirm("Leave this network? Local data will be cleared.")) return;
      await app.leave();
      await app.reset();
    });
  }
}

function renderDebug(): string {
  const sections: string[] = [];

  sections.push(`<button class="secondary" id="debug-back-btn" style="margin-bottom:12px">&larr; Back to Settings</button>`);

  // Build info
  const deployedLocal = new Date(__BUILD_TIME__).toLocaleString(undefined, { timeZoneName: "short" });
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  sections.push(`
    <div class="debug-section">
      <div class="debug-title">Build</div>
      <pre class="debug-pre">${esc(JSON.stringify({ deployed: deployedLocal, pwa_installed: isStandalone }, null, 2))}</pre>
    </div>
  `);

  // Device config
  if (app.config) {
    sections.push(`
      <div class="debug-section">
        <div class="debug-title">Device Config</div>
        <pre class="debug-pre">${esc(JSON.stringify({
          device_id: app.config.device_id,
          device_name: app.config.device_name,
          network_id: app.config.network_id,
          env: app.config.env,
        }, null, 2))}</pre>
      </div>
    `);
  }

  // Connection & encryption
  sections.push(`
    <div class="debug-section">
      <div class="debug-title">Status</div>
      <pre class="debug-pre">${esc(JSON.stringify({
        connection: app.connection,
        ntfy_url: app.ntfyUrl,
        encryption_enabled: app.encryptionEnabled,
        has_encryption_key: app.encryptionKey !== null,
      }, null, 2))}</pre>
    </div>
  `);

  // Topic links
  if (app.config) {
    const regTopic = registryTopicFromConfig(app.config);
    const devTopic = deviceTopicFromConfig(app.config);
    const base = app.ntfyUrl;
    sections.push(`
      <div class="debug-section">
        <div class="debug-title">Topics</div>
        <div class="debug-topic-row">
          <span class="debug-topic-label">registry</span>
          <a class="debug-topic-link" href="${esc(base)}/${esc(regTopic)}" target="_blank" rel="noopener">${esc(regTopic)}</a>
        </div>
        <div class="debug-topic-row">
          <span class="debug-topic-label">device</span>
          <a class="debug-topic-link" href="${esc(base)}/${esc(devTopic)}" target="_blank" rel="noopener">${esc(devTopic)}</a>
        </div>
      </div>
    `);
  }

  // Event log (most recent 50)
  const log = app.state.eventLog.slice(-50).reverse();
  sections.push(`
    <div class="debug-section">
      <div class="debug-title">Event Log (last ${log.length})</div>
      ${log.length === 0 ? '<div class="empty-state">No events recorded yet.</div>' : log.map((e) => `
        <div class="debug-event">
          <span class="debug-event-type">${esc(e.type)}</span>
          <span class="debug-event-dir">${e.direction}</span>
          <span class="debug-event-from">${esc(e.from_device_id)}</span>
          <span class="debug-event-time">${formatTime(e.timestamp)}</span>
        </div>
      `).join("")}
    </div>
  `);

  return sections.join("");
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 0) return date.toLocaleTimeString();
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return date.toLocaleDateString();
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
  const existing = document.querySelector(".error-toast");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = "error-toast";
  el.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);" +
    "background:#e94560;color:white;padding:10px 20px;border-radius:8px;" +
    "font-size:0.9rem;z-index:100;max-width:90vw;text-align:center;";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
