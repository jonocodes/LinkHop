import type { AnyProtocolEvent, DeviceConfig, LocalState, MessageBody, TextBody, UrlBody } from "../../src/protocol/types.js";
import { validateEvent } from "../../src/protocol/validate.js";
import { registryTopicFromConfig, deviceTopicFromConfig } from "../../src/protocol/topics.js";
import { generateDeviceId } from "../../src/protocol/ids.js";
import { deriveNetworkId } from "../../src/protocol/network.js";
import { deriveEncryptionKey, encryptBody, decryptBody } from "../../src/protocol/crypto.js";
import { createEmptyState } from "../../src/engine/state.js";
import { processEvent } from "../../src/engine/reducer.js";
import { actionAnnounce, actionHeartbeat, actionLeave, actionSend, actionMarkViewed, actionSyncRequest } from "../../src/engine/actions.js";
import type { Effect } from "../../src/engine/reducer.js";
import { loadConfig, saveConfig, loadState, saveState, clearAll, loadSeenEventIds, appendEvents, type BrowserConfig, type TransportKind } from "./db.js";
import { subscribeSSE, publishHTTP } from "./sse.js";
import { requestPermission, showMessageNotification, subscribeWebPush, unsubscribeWebPush } from "./notifications.js";

const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export type AppScreen = "setup" | "main";
export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface AppCallbacks {
  onStateChange: () => void;
  onScreenChange: (screen: AppScreen) => void;
  onConnectionChange: (status: ConnectionStatus) => void;
  onError: (msg: string) => void;
}

export class App {
  config: DeviceConfig | null = null;
  pool: string | null = null;
  state: LocalState = createEmptyState();
  screen: AppScreen = "setup";
  connection: ConnectionStatus = "disconnected";
  transportUrl = "https://ntfy.sh";
  transportKind: TransportKind = "ntfy";
  encryptionEnabled = false;
  encryptionKey: CryptoKey | null = null;
  selfSendEnabled = false;

  private callbacks: AppCallbacks;
  private cleanupSSE: (() => void)[] = [];
  private wasConnected = false;
  private seenEventIds: Set<string> = new Set();
  private hasSynced = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: AppCallbacks) {
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    const saved = await loadConfig();
    if (saved) {
      this.config = saved.device;
      this.pool = saved.pool ?? null;
      this.transportKind = saved.transport_kind;
      this.transportUrl = saved.transport_url;
      this.encryptionEnabled = saved.encryption_enabled ?? false;
      this.selfSendEnabled = saved.self_send_enabled ?? false;
      if (saved.pool && saved.password) {
        this.encryptionKey = await deriveEncryptionKey(saved.pool, saved.password);
      }
      this.state = await loadState();
      this.seenEventIds = await loadSeenEventIds();
      this.screen = "main";
      this.callbacks.onScreenChange("main");
      this.connect();
    } else {
      this.callbacks.onScreenChange("setup");
    }
  }

  async setup(name: string, pool: string, password: string, transportUrl: string, transportKind: TransportKind = "ntfy"): Promise<void> {
    const networkId = await deriveNetworkId(pool, password);
    this.pool = pool;
    this.transportUrl = transportUrl;
    this.transportKind = transportKind;
    this.encryptionKey = await deriveEncryptionKey(pool, password);
    this.encryptionEnabled = false;

    this.config = {
      device_id: generateDeviceId(),
      device_name: name,
      network_id: networkId,
      env: "live",
    };

    await saveConfig({
      device: this.config,
      transport_kind: this.transportKind,
      transport_url: this.transportUrl,
      ntfy_url: this.transportUrl,
      pool,
      password,
      encryption_enabled: false,
    });
    await requestPermission();
    this.state = createEmptyState();
    this.screen = "main";
    this.callbacks.onScreenChange("main");
    this.connect();
    await this.announce();
  }

  connect(): void {
    if (!this.config) return;
    this.disconnect();
    this.setConnection("connecting");

    const regTopic = registryTopicFromConfig(this.config);
    const devTopic = deviceTopicFromConfig(this.config);
    let openCount = 0;

    const onOpen = () => {
      openCount++;
      if (openCount >= 2) {
        this.setConnection("connected");
        // Announce on every connect so peers discover us — critical after
        // long offline periods where old announcements have expired from
        // the ntfy retention window.
        this.announce();
        if (!this.wasConnected) {
          // First connection — also try web push subscription (best effort)
          this.subscribeWebPush();
          // Schedule a sync request after initial SSE events have arrived,
          // so we pick the most recently seen peer to ask for the full
          // device list (covers the case where old announcements expired)
          this.scheduleSyncRequest();
        }
        this.wasConnected = true;
        this.startHeartbeat();
      }
    };

    const onError = () => {
      // EventSource auto-reconnects; just update status
      if (this.connection === "connected") {
        this.setConnection("connecting");
        openCount = 0;
      }
    };

    const onEvent = (event: AnyProtocolEvent) => this.handleEvent(event);

    this.cleanupSSE.push(
      subscribeSSE(this.transportUrl, regTopic, { onEvent, onOpen, onError }),
      subscribeSSE(this.transportUrl, devTopic, { onEvent, onOpen, onError }),
    );
  }

  disconnect(): void {
    for (const cleanup of this.cleanupSSE) cleanup();
    this.cleanupSSE = [];
    if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = null; }
    this.stopHeartbeat();
    this.setConnection("disconnected");
  }

  async toggleEncryption(): Promise<void> {
    this.encryptionEnabled = !this.encryptionEnabled;
    const saved = await loadConfig();
    if (saved) {
      saved.encryption_enabled = this.encryptionEnabled;
      await saveConfig(saved);
    }
    this.callbacks.onStateChange();
    // Re-announce so peers see updated capabilities
    await this.announce();
  }

  async toggleSelfSend(): Promise<void> {
    this.selfSendEnabled = !this.selfSendEnabled;
    const saved = await loadConfig();
    if (saved) {
      saved.self_send_enabled = this.selfSendEnabled;
      await saveConfig(saved);
    }
    this.callbacks.onStateChange();
  }

  async updateServer(url: string, kind?: TransportKind): Promise<void> {
    this.transportUrl = url;
    if (kind) this.transportKind = kind;
    const saved = await loadConfig();
    if (saved) {
      if (kind) saved.transport_kind = kind;
      saved.transport_url = url;
      saved.ntfy_url = url;
      await saveConfig(saved);
    }
    // Reconnect with the new server
    this.disconnect();
    this.connect();
    await this.announce();
  }

  private get capabilities(): string[] {
    return this.encryptionKey ? ["encryption"] : [];
  }

  async announce(): Promise<void> {
    if (!this.config) return;
    const effect = actionAnnounce(this.config, this.capabilities);
    await this.executeEffect(effect);
  }

  private scheduleSyncRequest(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    // Wait 3 seconds for initial SSE events to arrive, then pick the
    // most recently seen peer and request their device list
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.requestSync();
    }, 3000);
  }

  private async requestSync(): Promise<void> {
    if (!this.config || this.hasSynced) return;
    this.hasSynced = true;

    // Find the most recently seen peer (not us, not removed)
    const peers = [...this.state.devices.values()]
      .filter((d) => d.device_id !== this.config!.device_id && !d.is_removed)
      .sort((a, b) => b.last_event_at.localeCompare(a.last_event_at));

    if (peers.length === 0) return;

    const peer = peers[0];
    const effect = actionSyncRequest(this.config, peer.device_id, peer.device_topic);
    await this.executeEffect(effect);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.config) return;
    const effect = actionHeartbeat(this.config);
    await this.executeEffect(effect);
  }

  async leave(): Promise<void> {
    if (!this.config) return;
    const effect = actionLeave(this.config);
    await this.executeEffect(effect);
    await this.unsubscribeWebPush();
  }

  async reset(): Promise<void> {
    this.disconnect();
    await clearAll();
    this.config = null;
    this.state = createEmptyState();
    this.seenEventIds = new Set();
    this.wasConnected = false;
    this.hasSynced = false;
    this.screen = "setup";
    this.callbacks.onScreenChange("setup");
  }

  async dismissMessage(msgId: string): Promise<void> {
    this.state.messages.delete(msgId);
    await saveState(this.state);
    this.callbacks.onStateChange();
  }

  async markMessageViewed(msgId: string): Promise<void> {
    actionMarkViewed(this.state, msgId);
    await saveState(this.state);
    this.callbacks.onStateChange();
  }

  async send(toDeviceId: string, text: string): Promise<void> {
    await this.sendBody(toDeviceId, { kind: "text", text });
  }

  async sendUrl(toDeviceId: string, url: string, title?: string): Promise<void> {
    await this.sendBody(toDeviceId, { kind: "url", url, title });
  }

  private async sendBody(toDeviceId: string, inner: TextBody | UrlBody): Promise<void> {
    if (!this.config) return;
    const device = this.state.devices.get(toDeviceId);
    if (!device) {
      this.callbacks.onError(`Unknown device: ${toDeviceId}`);
      return;
    }

    let body: MessageBody;
    if (this.encryptionEnabled && this.encryptionKey) {
      const { ciphertext, iv } = await encryptBody(this.encryptionKey, JSON.stringify(inner));
      body = { kind: "encrypted", ciphertext, iv };
    } else {
      body = inner;
    }

    const effect = actionSend(this.state, this.config, toDeviceId, device.device_topic, body);
    await this.executeEffect(effect);
    await saveState(this.state);
    this.callbacks.onStateChange();
  }

  private async handleEvent(event: AnyProtocolEvent): Promise<void> {
    if (!this.config) return;
    const result = validateEvent(event, this.config.network_id);
    if (!result.valid) return;

    // Skip events we've already processed (e.g. replayed by SSE reconnect with ?since=12h)
    if (this.seenEventIds.has(result.event.event_id)) return;
    this.seenEventIds.add(result.event.event_id);

    // Try to decrypt encrypted message bodies before processing
    if (result.event.type === "msg.send" && result.event.payload.body.kind === "encrypted") {
      const encrypted = result.event.payload.body;
      if (this.encryptionKey) {
        const plaintext = await decryptBody(this.encryptionKey, encrypted.ciphertext, encrypted.iv);
        if (plaintext) {
          try {
            const inner = JSON.parse(plaintext) as TextBody | UrlBody;
            if (inner.kind === "text" && typeof inner.text === "string") {
              result.event.payload.body = inner;
            } else if (inner.kind === "url" && typeof inner.url === "string") {
              result.event.payload.body = inner;
            }
          } catch {
            // JSON parse failed — leave as encrypted
          }
        }
        // If decryption failed, body stays as kind:"encrypted" — UI handles display
      }
      // No encryption key — body stays as kind:"encrypted"
    }

    // Check if this is a new message for us (before processing, to detect new vs dup)
    const isNewMessage =
      result.event.type === "msg.send" &&
      result.event.payload.to_device_id === this.config.device_id &&
      !this.state.messages.has(result.event.payload.msg_id);

    const { effects } = processEvent(this.state, result.event, this.config);
    await saveState(this.state);
    // Persist the new event log entry so seenEventIds survives page reload
    // (sync events are not logged, so only persist for non-sync events)
    if (result.event.type !== "device.heartbeat" && result.event.type !== "sync.request" && result.event.type !== "sync.response") {
      const newEntry = this.state.eventLog[this.state.eventLog.length - 1];
      if (newEntry) appendEvents([newEntry]);
    }
    this.callbacks.onStateChange();

    // Show notification for new incoming messages
    if (isNewMessage && result.event.type === "msg.send") {
      const fromDevice = this.state.devices.get(result.event.from_device_id);
      const fromName = fromDevice?.device_name ?? result.event.from_device_id;
      const b = result.event.payload.body;
      const bodyText = b.kind === "text"
        ? b.text
        : b.kind === "url"
          ? `Shared a link: ${b.title ?? b.url}`
          : "[Encrypted message]";
      const notifUrl = b.kind === "url" ? b.url : undefined;
      showMessageNotification(fromName, bodyText, result.event.payload.msg_id, notifUrl);
    }

    for (const effect of effects) {
      await this.executeEffect(effect);
    }
  }

  private async subscribeWebPush(): Promise<void> {
    if (!this.config || this.transportKind !== "ntfy") return;
    const regTopic = registryTopicFromConfig(this.config);
    const devTopic = deviceTopicFromConfig(this.config);
    // Best effort — silently fails if ntfy doesn't have web push configured
    await Promise.all([
      subscribeWebPush(this.transportUrl, regTopic),
      subscribeWebPush(this.transportUrl, devTopic),
    ]);
  }

  private async unsubscribeWebPush(): Promise<void> {
    if (!this.config || this.transportKind !== "ntfy") return;
    const regTopic = registryTopicFromConfig(this.config);
    const devTopic = deviceTopicFromConfig(this.config);
    await Promise.all([
      unsubscribeWebPush(this.transportUrl, regTopic),
      unsubscribeWebPush(this.transportUrl, devTopic),
    ]);
  }

  private async executeEffect(effect: Effect): Promise<void> {
    if (effect.type === "publish") {
      try {
        await publishHTTP(this.transportUrl, effect.topic, effect.event);
      } catch (err) {
        this.callbacks.onError(`Publish failed: ${err}`);
      }
    }
  }

  private setConnection(status: ConnectionStatus): void {
    this.connection = status;
    this.callbacks.onConnectionChange(status);
  }
}
