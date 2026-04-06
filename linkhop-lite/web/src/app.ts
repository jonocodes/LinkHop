import type { AnyProtocolEvent, DeviceConfig, LocalState, MessageBody, TextBody } from "../../src/protocol/types.js";
import { validateEvent } from "../../src/protocol/validate.js";
import { registryTopicFromConfig, deviceTopicFromConfig } from "../../src/protocol/topics.js";
import { generateDeviceId } from "../../src/protocol/ids.js";
import { deriveNetworkId } from "../../src/protocol/network.js";
import { deriveEncryptionKey, encryptBody, decryptBody } from "../../src/protocol/crypto.js";
import { createEmptyState } from "../../src/engine/state.js";
import { processEvent } from "../../src/engine/reducer.js";
import { actionAnnounce, actionLeave, actionSend } from "../../src/engine/actions.js";
import type { Effect } from "../../src/engine/reducer.js";
import { loadConfig, saveConfig, loadState, saveState, clearAll, type BrowserConfig } from "./db.js";
import { subscribeSSE, publishHTTP } from "./sse.js";
import { requestPermission, showMessageNotification, subscribeWebPush, unsubscribeWebPush } from "./notifications.js";

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
  state: LocalState = createEmptyState();
  screen: AppScreen = "setup";
  connection: ConnectionStatus = "disconnected";
  ntfyUrl = "https://ntfy.sh";
  encryptionEnabled = false;
  encryptionKey: CryptoKey | null = null;
  selfSendEnabled = false;

  private callbacks: AppCallbacks;
  private cleanupSSE: (() => void)[] = [];
  private wasConnected = false;

  constructor(callbacks: AppCallbacks) {
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    const saved = await loadConfig();
    if (saved) {
      this.config = saved.device;
      this.ntfyUrl = saved.ntfy_url;
      this.encryptionEnabled = saved.encryption_enabled ?? false;
      this.selfSendEnabled = saved.self_send_enabled ?? false;
      if (saved.pool && saved.password) {
        this.encryptionKey = await deriveEncryptionKey(saved.pool, saved.password);
      }
      this.state = await loadState();
      this.screen = "main";
      this.callbacks.onScreenChange("main");
      this.connect();
    } else {
      this.callbacks.onScreenChange("setup");
    }
  }

  async setup(name: string, pool: string, password: string, ntfyUrl: string): Promise<void> {
    const networkId = await deriveNetworkId(pool, password);
    this.ntfyUrl = ntfyUrl;
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
      ntfy_url: this.ntfyUrl,
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
        // Re-announce on reconnect so peers see us
        if (this.wasConnected) {
          this.announce();
        } else {
          // First connection — try web push subscription (best effort, async)
          this.subscribeWebPush();
        }
        this.wasConnected = true;
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
      subscribeSSE(this.ntfyUrl, regTopic, { onEvent, onOpen, onError }),
      subscribeSSE(this.ntfyUrl, devTopic, { onEvent, onOpen, onError }),
    );
  }

  disconnect(): void {
    for (const cleanup of this.cleanupSSE) cleanup();
    this.cleanupSSE = [];
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

  async updateServer(url: string): Promise<void> {
    this.ntfyUrl = url;
    const saved = await loadConfig();
    if (saved) {
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
    this.wasConnected = false;
    this.screen = "setup";
    this.callbacks.onScreenChange("setup");
  }

  async send(toDeviceId: string, text: string): Promise<void> {
    if (!this.config) return;
    const device = this.state.devices.get(toDeviceId);
    if (!device) {
      this.callbacks.onError(`Unknown device: ${toDeviceId}`);
      return;
    }

    let body: MessageBody;
    if (this.encryptionEnabled && this.encryptionKey) {
      const inner: TextBody = { kind: "text", text };
      const { ciphertext, iv } = await encryptBody(this.encryptionKey, JSON.stringify(inner));
      body = { kind: "encrypted", ciphertext, iv };
    } else {
      body = { kind: "text", text };
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

    // Try to decrypt encrypted message bodies before processing
    if (result.event.type === "msg.send" && result.event.payload.body.kind === "encrypted") {
      const encrypted = result.event.payload.body;
      if (this.encryptionKey) {
        const plaintext = await decryptBody(this.encryptionKey, encrypted.ciphertext, encrypted.iv);
        if (plaintext) {
          try {
            const inner = JSON.parse(plaintext) as TextBody;
            if (inner.kind === "text" && typeof inner.text === "string") {
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
    this.callbacks.onStateChange();

    // Show notification for new incoming messages
    if (isNewMessage && result.event.type === "msg.send") {
      const fromDevice = this.state.devices.get(result.event.from_device_id);
      const fromName = fromDevice?.device_name ?? result.event.from_device_id;
      const bodyText = result.event.payload.body.kind === "text"
        ? result.event.payload.body.text
        : "[Encrypted message]";
      showMessageNotification(fromName, bodyText);
    }

    for (const effect of effects) {
      await this.executeEffect(effect);
    }
  }

  private async subscribeWebPush(): Promise<void> {
    if (!this.config) return;
    const regTopic = registryTopicFromConfig(this.config);
    const devTopic = deviceTopicFromConfig(this.config);
    // Best effort — silently fails if ntfy doesn't have web push configured
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

  private async executeEffect(effect: Effect): Promise<void> {
    if (effect.type === "publish") {
      try {
        await publishHTTP(this.ntfyUrl, effect.topic, effect.event);
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
