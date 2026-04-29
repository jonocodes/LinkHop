import { useState, useEffect, useReducer } from "react";
import { useNavigate } from "@tanstack/react-router";
import { App as AppClass, type AppScreen, type ConnectionStatus } from "./app";
import { getDevices, getInbox, getPending, getSent, getUnreadCount } from "../../src/engine/state";
import { registryTopicFromConfig, deviceTopicFromConfig } from "../../src/protocol/topics";
import type { MessageBody } from "../../src/protocol/types";

declare const __BUILD_TIME__: string;

export function App() {
  const navigate = useNavigate();
  const [, forceUpdate] = useReducer((count: number) => count + 1, 0);
  const [app] = useState(() => new AppClass({
    onStateChange: () => forceUpdate(),
    onScreenChange: (screen: AppScreen) => {
      if (screen === "setup") {
        navigate({ to: "/setup" });
      }
    },
    onConnectionChange: (_status: ConnectionStatus) => forceUpdate(),
    onError: (msg: string) => showError(msg),
  }));
  const [currentTab, setCurrentTab] = useState<"devices" | "inbox" | "outbox" | "settings">("devices");
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<"text" | "url">("text");
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    app.init();
  }, [app]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      const { type, msg_id } = event.data ?? {};
      if (typeof msg_id !== "string") return;

      if (type === "open-message") {
        setCurrentTab("inbox");
        setCurrentMessageId(msg_id);
        void app.markMessageViewed(msg_id);
      } else if (type === "mark-viewed") {
        void app.markMessageViewed(msg_id);
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [app]);

  const handleTabChange = (tab: typeof currentTab) => {
    setCurrentTab(tab);
    setCurrentMessageId(null);
  };

  const handleSend = async () => {
    const target = (document.getElementById("send-target") as HTMLSelectElement)?.value;
    const input = document.getElementById("send-text") as HTMLInputElement;
    const text = input?.value.trim();
    if (!target || !text) return;

    if (sendMode === "url") {
      await app.sendUrl(target, text);
    } else {
      await app.send(target, text);
    }
    input.value = "";
    setSendMode("text");
    input.placeholder = "Message...";
    setCurrentTab("outbox");
  };

  const handleSendTargetChange = (deviceId: string) => {
    setCurrentTab("outbox");
    setTimeout(() => {
      const select = document.getElementById("send-target") as HTMLSelectElement;
      if (select) select.value = deviceId;
      const input = document.getElementById("send-text") as HTMLInputElement;
      if (input) input.focus();
    }, 0);
  };

  const renderStatus = () => {
    const status = app.connection;
    const label = status === "connected" ? "Connected" : status === "connecting" ? "Reconnecting..." : "Disconnected";
    const deviceInfo = app.config ? ` · ${app.config.device_name}` : "";
    return { label, deviceInfo, status };
  };

  const renderDevices = () => {
    const devices = getDevices(app.state);
    if (devices.length === 0) {
      return <div className="empty-state">No devices discovered yet.<br />Other devices on the same network will appear here.</div>;
    }

    return [...devices]
      .sort((a, b) => Number(a.is_removed) - Number(b.is_removed))
      .map((d) => {
        const isSelf = d.device_id === app.config?.device_id;
        const isClickable = !isSelf && !d.is_removed;
        const badgeClass = isSelf ? "badge self" : d.is_removed ? "badge removed" : "badge";
        const badgeText = isSelf ? "you" : d.is_removed ? "left" : "active";
        const encryptionActive = app.encryptionEnabled && app.encryptionKey !== null && d.capabilities?.includes("encryption");
        const lastSeen = isSelf ? "" : ` · ${timeAgo(d.last_event_at)}`;

        return (
          <div
            key={d.device_id}
            className={`device-item${isClickable ? " device-item-clickable" : ""}${d.is_removed ? " device-item-removed" : ""}`}
            onClick={() => isClickable && handleSendTargetChange(d.device_id)}
          >
            <div>
              <div className="name">
                {esc(d.device_name)}
                {encryptionActive && <span className="capability-badge">encrypted</span>}
              </div>
              <div className="meta">
                {esc(d.device_id)}
                {lastSeen}
              </div>
            </div>
            <span className={badgeClass}>{badgeText}</span>
          </div>
        );
      });
  };

  const renderInbox = () => {
    if (!app.config) return "";
    const inbox = getInbox(app.state, app.config.device_id);
    if (inbox.length === 0) {
      return <div className="empty-state">No messages yet.<br />Send one using the form below.</div>;
    }

    return [...inbox]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((m) => {
        const from = app.state.devices.get(m.from_device_id);
        const fromLabel = from ? from.device_name : m.from_device_id;
        const bodyHtml = renderMessageBody(m.body);
        const isUnread = m.state === "received";
        const stateBadge = isUnread ? <span className="msg-state-badge new">New</span> : <span className="msg-state-badge viewed">Viewed</span>;

        return (
          <div
            key={m.msg_id}
            className={`msg-item ${isUnread ? "received" : "viewed"} msg-item-clickable`}
            onClick={async () => {
              setCurrentMessageId(m.msg_id);
              await app.markMessageViewed(m.msg_id);
            }}
          >
            <div className="msg-item-header">
              <span className="msg-from">From {esc(fromLabel)}</span>
              <div className="msg-item-actions">
                {stateBadge}
                <button
                  className="msg-dismiss"
                  data-msg-id={m.msg_id}
                  title="Dismiss"
                  onClick={async (e: React.MouseEvent) => {
                    e.stopPropagation();
                    await app.dismissMessage(m.msg_id);
                    forceUpdate();
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="msg-body">{bodyHtml}</div>
            <div className="msg-time">{formatTime(m.created_at)}</div>
          </div>
        );
      });
  };

  const renderMessageDetail = () => {
    if (!app.config || !currentMessageId) return null;
    const m = app.state.messages.get(currentMessageId);
    if (!m) {
      return (
        <div>
          <button className="secondary" onClick={() => setCurrentMessageId(null)} style={{ marginBottom: 12 }}>
            ← Back
          </button>
          <div className="empty-state">Message not found.</div>
        </div>
      );
    }
    const from = app.state.devices.get(m.from_device_id);
    const fromLabel = from ? from.device_name : m.from_device_id;
    const bodyHtml = renderMessageBody(m.body);
    const stateLabel = m.state === "received" ? "New" : "Viewed";
    const stateClass = m.state === "received" ? "new" : "viewed";
    const viewedLine = m.viewed_at ? <div className="msg-detail-meta">Viewed {formatTime(m.viewed_at)}</div> : "";

    return (
      <div className="msg-detail">
        <button className="secondary" onClick={() => setCurrentMessageId(null)} style={{ marginBottom: 12 }}>
          ← Back to Inbox
        </button>
        <div className="msg-detail-header">
          <div className="msg-detail-from">From {esc(fromLabel)}</div>
          <span className={`msg-state-badge ${stateClass}`}>{stateLabel}</span>
        </div>
        <div className="msg-detail-body">{bodyHtml}</div>
        <div className="msg-detail-meta">Received {formatTime(m.created_at)}</div>
        {viewedLine}
        <button
          className="msg-dismiss secondary"
          style={{ marginTop: 16 }}
          onClick={async () => {
            await app.dismissMessage(m.msg_id);
            setCurrentMessageId(null);
          }}
        >
          Dismiss message
        </button>
      </div>
    );
  };

  const renderPending = () => {
    if (!app.config) return "";
    const pending = getPending(app.state, app.config.device_id);
    const sent = getSent(app.state, app.config.device_id);

    const renderMsg = (m: (typeof pending)[0], isPending: boolean) => {
      const to = app.state.devices.get(m.to_device_id);
      const toLabel = to ? to.device_name : m.to_device_id;
      const bodyHtml = renderMessageBody(m.body);
      const timeStr = isPending ? `${formatTime(m.created_at)} · attempt ${m.last_attempt_id}` : formatTime(m.created_at);

      return (
        <div key={m.msg_id} className={`msg-item ${isPending ? "pending" : "received"}`}>
          <div className="msg-item-header">
            <span className="msg-from">To {esc(toLabel)}</span>
            <div className="msg-item-actions">
              <button
                className="msg-dismiss"
                data-msg-id={m.msg_id}
                title="Dismiss"
                onClick={async () => {
                  await app.dismissMessage(m.msg_id);
                  forceUpdate();
                }}
              >
                ×
              </button>
            </div>
          </div>
          <div className="msg-body">{bodyHtml}</div>
          <div className="msg-time">{timeStr}</div>
        </div>
      );
    };

    return (
      <>
        <div className="section-header">Pending</div>
        {pending.length === 0 ? (
          <div className="empty-state" style={{ fontSize: "0.85rem" }}>
            No pending messages.
          </div>
        ) : (
          [...pending]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((m) => renderMsg(m, true))
        )}
        <div className="section-header">Sent</div>
        {sent.length === 0 ? (
          <div className="empty-state" style={{ fontSize: "0.85rem" }}>
            No sent messages.
          </div>
        ) : (
          [...sent]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((m) => renderMsg(m, false))
        )}
      </>
    );
  };

  const renderMessageBody = (body: MessageBody): React.ReactNode => {
    if (body.kind === "text") {
      return <>{esc(body.text)}</>;
    }
    if (body.kind === "url") {
      const safe = isUrl(body.url) ? body.url : "#";
      return (
        <a className="url-card" href={safe} target="_blank" rel="noopener noreferrer">
          {body.title && <div className="url-card-title">{esc(body.title)}</div>}
          <div className="url-card-url">{esc(body.url)}</div>
        </a>
      );
    }
    return <span className="encrypted-msg">Encrypted message — cannot decrypt</span>;
  };

  const renderSettings = () => {
    const encOn = app.encryptionEnabled && app.encryptionKey !== null;
    const rsUser = app.config?.rs_user ?? "—";
    const pollSec = app.rsSettings.poll_interval_seconds;
    const cullDays = app.rsSettings.message_cull_days;

    return (
      <>
        <div className="settings-section">
          <div className="settings-label">RemoteStorage</div>
          <div className="settings-row">
            <span className="settings-value">{esc(rsUser)}</span>
            <span className={`rs-status-badge ${app.rsConnected ? "connected" : "disconnected"}`}>
              {app.rsConnected ? "connected" : "offline"}
            </span>
          </div>
          <div className="settings-hint">Your data is stored in your RS account.</div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Encryption</div>
          <div className="settings-row">
            <span>{encOn ? "On — messages encrypted" : "Off — plaintext"}</span>
            <button
              className={`settings-toggle ${encOn ? "on" : ""}`}
              onClick={async () => {
                await app.toggleEncryption();
                forceUpdate();
              }}
            >
              {encOn ? "On" : "Off"}
            </button>
          </div>
          <div className="settings-hint">Encrypts message bodies in RS and on ntfy. Affects all devices.</div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Poll interval</div>
          <div className="settings-row">
            <input
              type="number"
              min={60}
              max={86400}
              step={60}
              className="settings-number-input"
              defaultValue={pollSec}
              onBlur={async (e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 60) {
                  await app.updateRSSettings({ poll_interval_seconds: v });
                  forceUpdate();
                }
              }}
            />
            <span className="settings-unit">seconds</span>
          </div>
          <div className="settings-hint">How often to poll RemoteStorage for missed messages. Default: 600 (10 min).</div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Message retention</div>
          <div className="settings-row">
            <input
              type="number"
              min={1}
              max={365}
              className="settings-number-input"
              defaultValue={cullDays}
              onBlur={async (e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1) {
                  await app.updateRSSettings({ message_cull_days: v });
                  forceUpdate();
                }
              }}
            />
            <span className="settings-unit">days</span>
          </div>
          <div className="settings-hint">Messages older than this are deleted from RemoteStorage. Default: 30.</div>
        </div>

        <div className="settings-section">
          <div className="settings-label">ntfy server</div>
          <div className="settings-row settings-row-input">
            <input
              type="url"
              className="settings-url-input"
              defaultValue={app.ntfyUrl}
              onBlur={async (e) => {
                const v = e.target.value.trim();
                if (v && v !== app.ntfyUrl) {
                  await app.updateNtfyUrl(v);
                  forceUpdate();
                }
              }}
            />
          </div>
          <div className="settings-hint">Real-time delivery and push notifications.</div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Self-send</div>
          <div className="settings-row">
            <span>{app.selfSendEnabled ? "Enabled" : "Disabled"}</span>
            <button
              className={`settings-toggle ${app.selfSendEnabled ? "on" : ""}`}
              onClick={async () => {
                await app.toggleSelfSend();
                forceUpdate();
              }}
            >
              {app.selfSendEnabled ? "On" : "Off"}
            </button>
          </div>
          <div className="settings-hint">Allow sending messages to this device (useful for testing).</div>
        </div>

        <div className="settings-section">
          <button className="secondary" onClick={() => setShowDebug(true)}>
            Debug info
          </button>
        </div>

        <div className="settings-section">
          <button
            className="secondary settings-leave"
            onClick={async () => {
              if (!confirm("Leave this network? Local data will be cleared.")) return;
              await app.leave();
              await app.reset();
              navigate({ to: "/setup" });
            }}
          >
            Leave Network
          </button>
        </div>
      </>
    );
  };

  const renderDebug = () => {
    const deployedLocal = new Date(__BUILD_TIME__).toLocaleString(undefined, { timeZoneName: "short" });
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    return (
      <>
        <button className="secondary" onClick={() => setShowDebug(false)} style={{ marginBottom: 12 }}>
          ← Back to Settings
        </button>
        <div className="debug-section">
          <div className="debug-title">Build</div>
          <pre className="debug-pre">
            {JSON.stringify({ deployed: deployedLocal, pwa_installed: isStandalone }, null, 2)}
          </pre>
        </div>
        {app.config && (
          <div className="debug-section">
            <div className="debug-title">Device</div>
            <pre className="debug-pre">
              {JSON.stringify(
                {
                  device_id: app.config.device_id,
                  device_name: app.config.device_name,
                  network_id: app.config.network_id,
                  rs_user: app.config.rs_user,
                  env: app.config.env,
                },
                null,
                2
              )}
            </pre>
          </div>
        )}
        <div className="debug-section">
          <div className="debug-title">Status</div>
          <pre className="debug-pre">
            {JSON.stringify(
              {
                connection: app.connection,
                rs_connected: app.rsConnected,
                ntfy_url: app.ntfyUrl,
                encryption_enabled: app.encryptionEnabled,
                has_encryption_key: app.encryptionKey !== null,
                poll_interval_seconds: app.rsSettings.poll_interval_seconds,
                message_cull_days: app.rsSettings.message_cull_days,
              },
              null,
              2
            )}
          </pre>
        </div>
        {app.config && (
          <div className="debug-section">
            <div className="debug-title">ntfy Topics</div>
            <div className="debug-topic-row">
              <span className="debug-topic-label">registry</span>
              <a
                className="debug-topic-link"
                href={`${app.ntfyUrl}/${esc(registryTopicFromConfig(app.config))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {esc(registryTopicFromConfig(app.config))}
              </a>
            </div>
            <div className="debug-topic-row">
              <span className="debug-topic-label">device</span>
              <a
                className="debug-topic-link"
                href={`${app.ntfyUrl}/${esc(deviceTopicFromConfig(app.config))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {esc(deviceTopicFromConfig(app.config))}
              </a>
            </div>
          </div>
        )}
      </>
    );
  };

  const { label: statusLabel, deviceInfo: statusDeviceInfo, status } = renderStatus();

  const unreadCount = app.config ? getUnreadCount(app.state, app.config.device_id) : 0;

  const devices = getDevices(app.state).filter(
    (d) => (app.selfSendEnabled || d.device_id !== app.config?.device_id) && !d.is_removed,
  );

  return (
    <div className="screen active">
      <div className="status-bar">
        <span className={`status-dot ${status === "connected" ? "connected" : status === "connecting" ? "connecting" : ""}`}></span>
        <span id="status-text">{statusLabel}{statusDeviceInfo}</span>
        <span className="status-spacer"></span>
      </div>

      {status === "connecting" && (
        <div className="offline-banner">Connection lost. Reconnecting...</div>
      )}

      <div className="tab-bar">
        <button className={currentTab === "devices" ? "active" : ""} onClick={() => handleTabChange("devices")}>
          Devices
        </button>
        <button className={currentTab === "inbox" ? "active" : ""} onClick={() => handleTabChange("inbox")}>
          Inbox
          {unreadCount > 0 && currentTab !== "inbox" && <span className="tab-badge">{unreadCount}</span>}
        </button>
        <button className={currentTab === "outbox" ? "active" : ""} onClick={() => handleTabChange("outbox")}>
          Outbox
        </button>
        <button className={currentTab === "settings" ? "active" : ""} onClick={() => handleTabChange("settings")}>
          Settings
        </button>
      </div>

      {(currentTab === "outbox" || currentTab === "inbox") && (
        <div className="send-form">
          <div className="send-top-row">
            <select id="send-target">
              <option value="">Select device...</option>
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.device_name}
                </option>
              ))}
            </select>
            <button
              className={`send-mode-btn ${sendMode === "url" ? "active" : ""}`}
              onClick={() => {
                setSendMode(sendMode === "text" ? "url" : "text");
                const input = document.getElementById("send-text") as HTMLInputElement;
                if (input) input.placeholder = sendMode === "url" ? "Message..." : "Paste a URL...";
              }}
            >
              {sendMode === "url" ? "URL" : "Text"}
            </button>
          </div>
          <div className="send-row">
            <input
              id="send-text"
              type="text"
              placeholder={sendMode === "url" ? "Paste a URL..." : "Message..."}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
            />
            <button id="send-btn" onClick={handleSend}>
              Send
            </button>
          </div>
        </div>
      )}

      <div id="main-content">
        {currentTab === "devices" && renderDevices()}
        {currentTab === "inbox" && (currentMessageId ? renderMessageDetail() : renderInbox())}
        {currentTab === "outbox" && renderPending()}
        {currentTab === "settings" && (showDebug ? renderDebug() : renderSettings())}
      </div>
    </div>
  );
}

function esc(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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

function timeAgo(iso: string): string {
  try {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return "seen now";
    if (sec < 3600) return `seen ${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `seen ${Math.floor(sec / 3600)}h ago`;
    return `seen ${Math.floor(sec / 86400)}d ago`;
  } catch {
    return "";
  }
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
