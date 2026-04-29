import type {
  AnyProtocolEvent,
  DeviceConfig,
  LocalState,
  MessageBody,
  MessageRecord,
  TextBody,
  UrlBody,
} from "../../src/protocol/types.js";
import { validateEvent } from "../../src/protocol/validate.js";
import { registryTopicFromConfig, deviceTopicFromConfig } from "../../src/protocol/topics.js";
import { generateDeviceId } from "../../src/protocol/ids.js";
import { deriveNetworkId, generateNetworkSecret } from "../../src/protocol/network.js";
import { deriveEncryptionKey, encryptBody, decryptBody } from "../../src/protocol/crypto.js";
import { createEmptyState } from "../../src/engine/state.js";
import { processEvent } from "../../src/engine/reducer.js";
import { actionAnnounce, actionLeave, actionSend, actionMarkViewed } from "../../src/engine/actions.js";
import type { Effect } from "../../src/engine/reducer.js";
import { loadConfig, saveConfig, clearAll, saveRSToken, type BrowserConfig } from "./db.js";
import { subscribeSSE, publishHTTP } from "./sse.js";
import { requestPermission, showMessageNotification, subscribeWebPush, unsubscribeWebPush } from "./notifications.js";
import { RSStore, DEFAULT_SETTINGS, type RSSettings } from "./rs.js";

const DEFAULT_NTFY_URL = "https://ntfy.sh";
const ADAPTIVE_POLL_MS = 20_000;

export type AppScreen = "setup" | "connecting" | "main";
export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface AppCallbacks {
  onStateChange?: () => void;
  onScreenChange?: (screen: AppScreen) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  onError?: (msg: string) => void;
  onWarning?: (msg: string) => void;
}

export class App {
  config: DeviceConfig | null = null;
  state: LocalState = createEmptyState();
  screen: AppScreen = "setup";
  connection: ConnectionStatus = "disconnected";
  ntfyUrl = DEFAULT_NTFY_URL;
  rsSettings: RSSettings = { ...DEFAULT_SETTINGS };
  encryptionEnabled = false;
  encryptionKey: CryptoKey | null = null;
  selfSendEnabled = false;
  rsConnected = false;

  private callbacks: AppCallbacks;
  private rs: RSStore | null = null;
  private cleanupSSE: (() => void)[] = [];
  private seenEventIds: Set<string> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private adaptivePollTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDeviceName: string | null = null;
  private pendingNtfyUrl: string | null = null;

  constructor(callbacks: AppCallbacks) {
    this.callbacks = callbacks;
    this.bindServiceWorkerMessages();
  }

  async init(): Promise<void> {
    const saved = await loadConfig();
    if (saved?.device?.rs_user) {
      this.config = saved.device;
      this.ntfyUrl = saved.ntfy_url ?? DEFAULT_NTFY_URL;
      this.selfSendEnabled = saved.self_send_enabled ?? false;
      this.screen = "connecting";
      this.callbacks.onScreenChange?.("connecting");
      this.connectRS(saved.device.rs_user);
    } else {
      this.callbacks.onScreenChange?.("setup");
    }
  }

  /**
   * First-time setup. Called after user enters device name, RS handle, and ntfy URL.
   * Triggers RS OAuth — the page may redirect. On return, the "connected" event
   * fires and onRSConnected completes setup.
   */
  async setup(deviceName: string, rsUser: string, ntfyUrl: string): Promise<void> {
    this.pendingDeviceName = deviceName;
    this.pendingNtfyUrl = ntfyUrl;
    // Persist pending setup so we can resume after OAuth redirect
    sessionStorage.setItem("linkhop_pending_setup", JSON.stringify({ deviceName, rsUser, ntfyUrl }));
    this.screen = "connecting";
    this.callbacks.onScreenChange?.("connecting");
    this.connectRS(rsUser);
  }

  private connectRS(rsUser: string): void {
    this.rs = new RSStore();

    this.rs.onConnected(async (connectedUser) => {
      // Save RS token for service worker use
      const href = this.rs!.getStorageHref();
      const token = this.rs!.getToken();
      if (href && token) {
        await saveRSToken({ href, token });
      }

      await this.onRSConnected(connectedUser);
    });

    this.rs.onDisconnected(() => {
      this.rsConnected = false;
      this.callbacks.onStateChange?.();
    });

    this.rs.onError((err) => {
      this.callbacks.onError?.(`RS error: ${err.message}`);
    });

    this.rs.connect(rsUser);
  }

  private async onRSConnected(rsUser: string): Promise<void> {
    this.rsConnected = true;

    // Check for RS user change
    if (this.config?.rs_user && this.config.rs_user !== rsUser) {
      this.callbacks.onWarning?.(
        `Connected RS account (${rsUser}) differs from the one used to set up this device (${this.config.rs_user}). ` +
        `Network identity has changed — please reset the app if you intended to switch accounts.`,
      );
      return;
    }

    // Load or initialise RS settings
    let settings = await this.rs!.getSettings();
    if (!settings || !settings.network_secret) {
      settings = {
        ...DEFAULT_SETTINGS,
        network_secret: generateNetworkSecret(),
      };
      await this.rs!.saveSettings(settings);
    }
    this.rsSettings = settings;
    this.encryptionEnabled = settings.encryption_enabled;
    if (settings.encryption_enabled) {
      this.encryptionKey = await deriveEncryptionKey(settings.network_secret);
    }

    const networkId = await deriveNetworkId(rsUser, settings.network_secret);

    // First-time setup: build and persist DeviceConfig
    if (!this.config) {
      const pending = this.loadPendingSetup();
      const deviceName = pending?.deviceName ?? this.pendingDeviceName ?? rsUser;
      this.ntfyUrl = pending?.ntfyUrl ?? this.pendingNtfyUrl ?? DEFAULT_NTFY_URL;

      this.config = {
        device_id: generateDeviceId(),
        device_name: deviceName,
        network_id: networkId,
        rs_user: rsUser,
        env: "live",
      };
      await saveConfig({ device: this.config, ntfy_url: this.ntfyUrl, self_send_enabled: false });
      sessionStorage.removeItem("linkhop_pending_setup");
      await requestPermission();
    }

    // Load state from RS
    await this.loadStateFromRS();

    // Wire RS change listener for live updates while tab is open
    this.rs!.onChange(() => {
      void this.pollRS();
    });

    this.screen = "main";
    this.callbacks.onScreenChange?.("main");
    this.callbacks.onStateChange?.();

    // Connect ntfy SSE and announce
    this.connect();
    await this.announce();

    // Start standard poll loop
    this.startPollLoop();
  }

  private loadPendingSetup(): { deviceName: string; rsUser: string; ntfyUrl: string } | null {
    try {
      const raw = sessionStorage.getItem("linkhop_pending_setup");
      if (!raw) return null;
      return JSON.parse(raw) as { deviceName: string; rsUser: string; ntfyUrl: string };
    } catch {
      return null;
    }
  }

  private async loadStateFromRS(): Promise<void> {
    if (!this.config || !this.rs) return;
    const { network_id } = this.config;

    const [devices, messages] = await Promise.all([
      this.rs.listDevices(network_id),
      this.rs.listMessages(network_id),
    ]);

    this.state = createEmptyState();
    for (const d of devices) {
      if (!d.is_removed) this.state.devices.set(d.device_id, d);
    }
    for (const m of messages) {
      this.state.messages.set(m.msg_id, m);
    }
  }

  private async pollRS(): Promise<void> {
    if (!this.config || !this.rs) return;
    const { network_id } = this.config;

    const [devices, messages] = await Promise.all([
      this.rs.listDevices(network_id),
      this.rs.listMessages(network_id),
    ]);

    for (const d of devices) {
      const existing = this.state.devices.get(d.device_id);
      if (!existing || d.last_event_at > existing.last_event_at) {
        if (d.is_removed) {
          this.state.devices.delete(d.device_id);
        } else {
          this.state.devices.set(d.device_id, d);
        }
      }
    }

    let gotNewMessages = false;
    for (const m of messages) {
      if (!this.state.messages.has(m.msg_id)) {
        this.state.messages.set(m.msg_id, m);
        gotNewMessages = true;
        // Show notification for new incoming messages discovered via poll
        if (m.to_device_id === this.config.device_id && m.state === "received") {
          await this.notifyMessage(m);
        }
      } else {
        // Sync state changes (e.g. pending → received discovered via poll)
        const existing = this.state.messages.get(m.msg_id)!;
        if (m.state !== existing.state) {
          this.state.messages.set(m.msg_id, m);
        }
      }
    }

    if (gotNewMessages || devices.length > 0) {
      this.callbacks.onStateChange?.();
    }
  }

  private startPollLoop(): void {
    this.stopPollLoop();
    const intervalMs = (this.rsSettings.poll_interval_seconds ?? DEFAULT_SETTINGS.poll_interval_seconds) * 1000;
    this.pollTimer = setInterval(() => { void this.pollRS(); }, intervalMs);
  }

  private stopPollLoop(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.adaptivePollTimer) { clearTimeout(this.adaptivePollTimer); this.adaptivePollTimer = null; }
  }

  private scheduleAdaptivePoll(): void {
    if (this.adaptivePollTimer) clearTimeout(this.adaptivePollTimer);
    this.adaptivePollTimer = setTimeout(() => {
      this.adaptivePollTimer = null;
      void this.pollRS();
    }, ADAPTIVE_POLL_MS);
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
        void this.subscribeWebPush();
      }
    };

    const onError = () => {
      if (this.connection === "connected") {
        this.setConnection("connecting");
        openCount = 0;
      }
    };

    const onEvent = (event: AnyProtocolEvent) => { void this.handleEvent(event); };

    this.cleanupSSE.push(
      subscribeSSE(this.ntfyUrl, regTopic, { onEvent, onOpen, onError }),
      subscribeSSE(this.ntfyUrl, devTopic, { onEvent, onOpen, onError }),
    );
  }

  disconnect(): void {
    for (const cleanup of this.cleanupSSE) cleanup();
    this.cleanupSSE = [];
    this.setConnection("disconnected");
  }

  async leave(): Promise<void> {
    if (!this.config || !this.rs) return;
    const now = new Date().toISOString();
    await this.rs.markDeviceRemoved(this.config.network_id, this.config.device_id, now);
    const effect = actionLeave(this.config);
    await this.executeEffect(effect);
    await this.unsubscribeWebPush();
  }

  async reset(): Promise<void> {
    this.stopPollLoop();
    this.disconnect();
    this.rs?.disconnect();
    this.rs = null;
    await clearAll();
    this.config = null;
    this.state = createEmptyState();
    this.seenEventIds = new Set();
    this.rsConnected = false;
    this.screen = "setup";
    this.callbacks.onScreenChange?.("setup");
  }

  async announce(): Promise<void> {
    if (!this.config || !this.rs) return;
    const now = new Date().toISOString();

    // Build device record for RS
    const record = {
      device_id: this.config.device_id,
      device_name: this.config.device_name,
      device_topic: deviceTopicFromConfig(this.config),
      last_event_at: now,
      last_event_type: "device.announce" as const,
      is_removed: false,
      capabilities: this.encryptionKey ? ["encryption"] : [],
    };
    await this.rs.upsertDevice(this.config.network_id, record);

    const effect = actionAnnounce(this.config, record.capabilities);
    await this.executeEffect(effect);
  }

  async send(toDeviceId: string, text: string): Promise<void> {
    await this.sendBody(toDeviceId, { kind: "text", text });
  }

  async sendUrl(toDeviceId: string, url: string, title?: string): Promise<void> {
    await this.sendBody(toDeviceId, { kind: "url", url, title });
  }

  private async sendBody(toDeviceId: string, inner: TextBody | UrlBody): Promise<void> {
    if (!this.config || !this.rs) return;
    const device = this.state.devices.get(toDeviceId);
    if (!device) {
      this.callbacks.onError?.(`Unknown device: ${toDeviceId}`);
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

    // Write to RS first (durable store)
    const msg = this.state.messages.get(
      (effect as { type: "publish"; event: { payload: { msg_id: string } } }).event.payload.msg_id,
    );
    if (msg) {
      await this.rs.upsertMessage(this.config.network_id, msg);
    }

    // Then publish via ntfy for real-time delivery
    await this.executeEffect(effect);

    this.callbacks.onStateChange?.();
    // Adaptive poll to catch receipt quickly
    this.scheduleAdaptivePoll();
  }

  async markMessageViewed(msgId: string): Promise<void> {
    if (!this.rs || !this.config) return;
    actionMarkViewed(this.state, msgId);
    const now = new Date().toISOString();
    await this.rs.updateMessageState(this.config.network_id, msgId, "viewed", now);
    this.callbacks.onStateChange?.();
  }

  async dismissMessage(msgId: string): Promise<void> {
    this.state.messages.delete(msgId);
    this.callbacks.onStateChange?.();
  }

  async updateNtfyUrl(url: string): Promise<void> {
    this.ntfyUrl = url;
    const saved = await loadConfig();
    if (saved) {
      saved.ntfy_url = url;
      await saveConfig(saved);
    }
    this.disconnect();
    this.connect();
    await this.announce();
  }

  async toggleEncryption(): Promise<void> {
    if (!this.rs) return;
    this.encryptionEnabled = !this.encryptionEnabled;
    this.rsSettings.encryption_enabled = this.encryptionEnabled;
    if (this.encryptionEnabled && !this.encryptionKey) {
      this.encryptionKey = await deriveEncryptionKey(this.rsSettings.network_secret);
    }
    await this.rs.saveSettings(this.rsSettings);
    this.callbacks.onStateChange?.();
    await this.announce();
  }

  async toggleSelfSend(): Promise<void> {
    this.selfSendEnabled = !this.selfSendEnabled;
    const saved = await loadConfig();
    if (saved) {
      saved.self_send_enabled = this.selfSendEnabled;
      await saveConfig(saved);
    }
    this.callbacks.onStateChange?.();
  }

  async updateRSSettings(patch: Partial<Pick<RSSettings, "poll_interval_seconds" | "message_cull_days">>): Promise<void> {
    if (!this.rs) return;
    this.rsSettings = { ...this.rsSettings, ...patch };
    await this.rs.saveSettings(this.rsSettings);
    // Restart poll loop with new interval
    this.startPollLoop();
    this.callbacks.onStateChange?.();
  }

  private async handleEvent(event: AnyProtocolEvent): Promise<void> {
    if (!this.config) return;
    const result = validateEvent(event, this.config.network_id);
    if (!result.valid) return;

    if (this.seenEventIds.has(result.event.event_id)) return;
    this.seenEventIds.add(result.event.event_id);

    // Decrypt encrypted message bodies
    if (result.event.type === "msg.send" && result.event.payload.body.kind === "encrypted") {
      const encrypted = result.event.payload.body;
      if (this.encryptionKey) {
        const plaintext = await decryptBody(this.encryptionKey, encrypted.ciphertext, encrypted.iv);
        if (plaintext) {
          try {
            const inner = JSON.parse(plaintext) as TextBody | UrlBody;
            if (inner.kind === "text" || inner.kind === "url") {
              result.event.payload.body = inner;
            }
          } catch { /* leave as encrypted */ }
        }
      }
    }

    const { effects, newMessage } = processEvent(this.state, result.event, this.config);

    // Persist new incoming message to RS and notify
    if (newMessage && result.event.type === "msg.send" && this.rs) {
      const msg = this.state.messages.get(result.event.payload.msg_id);
      if (msg) {
        await this.rs.upsertMessage(this.config.network_id, msg);
        await this.notifyMessage(msg);
      }
    }

    this.callbacks.onStateChange?.();

    for (const effect of effects) {
      await this.executeEffect(effect);
    }
  }

  private async notifyMessage(msg: MessageRecord): Promise<void> {
    const fromDevice = this.state.devices.get(msg.from_device_id);
    const fromName = fromDevice?.device_name ?? msg.from_device_id;
    const b = msg.body;
    const bodyText =
      b.kind === "text" ? b.text :
      b.kind === "url" ? `Shared a link: ${b.title ?? b.url}` :
      "[Encrypted message]";
    const notifUrl = b.kind === "url" ? b.url : undefined;
    showMessageNotification(fromName, bodyText, msg.msg_id, notifUrl);
  }

  private async subscribeWebPush(): Promise<void> {
    if (!this.config) return;
    const regTopic = registryTopicFromConfig(this.config);
    const devTopic = deviceTopicFromConfig(this.config);
    await Promise.all([
      subscribeWebPush(this.ntfyUrl, regTopic),
      subscribeWebPush(this.ntfyUrl, devTopic),
    ]);
  }

  private async unsubscribeWebPush(): Promise<void> {
    if (!this.config) return;
    const regTopic = registryTopicFromConfig(this.config);
    const devTopic = deviceTopicFromConfig(this.config);
    await Promise.all([
      unsubscribeWebPush(this.ntfyUrl, regTopic),
      unsubscribeWebPush(this.ntfyUrl, devTopic),
    ]);
  }

  private async executeEffect(effect: Effect): Promise<boolean> {
    if (effect.type === "publish") {
      try {
        await publishHTTP(this.ntfyUrl, effect.topic, effect.event);
        return true;
      } catch (err) {
        this.callbacks.onError?.(`Publish failed: ${err}`);
        return false;
      }
    }
    return false;
  }

  private bindServiceWorkerMessages(): void {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
      const msg = event.data as { type?: string; msg_id?: string };
      if (msg?.type === "mark-viewed" && msg.msg_id) {
        void this.markMessageViewed(msg.msg_id);
      }
    });
  }

  private setConnection(status: ConnectionStatus): void {
    this.connection = status;
    this.callbacks.onConnectionChange?.(status);
  }
}
