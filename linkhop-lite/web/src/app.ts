import type { AnyProtocolEvent, DeviceConfig, LocalState, MessageBody } from "../../src/protocol/types.js";
import { validateEvent } from "../../src/protocol/validate.js";
import { registryTopicFromConfig, deviceTopicFromConfig } from "../../src/protocol/topics.js";
import { generateDeviceId } from "../../src/protocol/ids.js";
import { deriveNetworkId } from "../../src/protocol/network.js";
import { createEmptyState } from "../../src/engine/state.js";
import { processEvent } from "../../src/engine/reducer.js";
import { actionAnnounce, actionLeave, actionSend } from "../../src/engine/actions.js";
import type { Effect } from "../../src/engine/reducer.js";
import { loadConfig, saveConfig, loadState, saveState, clearAll, type BrowserConfig } from "./db.js";
import { subscribeSSE, publishHTTP } from "./sse.js";

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
  ntfyUrl = "http://localhost:8080";

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
      this.state = await loadState();
      this.screen = "main";
      this.callbacks.onScreenChange("main");
      this.connect();
    } else {
      this.callbacks.onScreenChange("setup");
    }
  }

  async setup(name: string, password: string, ntfyUrl: string): Promise<void> {
    const networkId = await deriveNetworkId(password);
    this.ntfyUrl = ntfyUrl;

    this.config = {
      device_id: generateDeviceId(),
      device_name: name,
      network_id: networkId,
      env: "live",
    };

    await saveConfig({ device: this.config, ntfy_url: this.ntfyUrl });
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

  async announce(): Promise<void> {
    if (!this.config) return;
    const effect = actionAnnounce(this.config);
    await this.executeEffect(effect);
  }

  async leave(): Promise<void> {
    if (!this.config) return;
    const effect = actionLeave(this.config);
    await this.executeEffect(effect);
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

    const body: MessageBody = { kind: "text", text };
    const effect = actionSend(this.state, this.config, toDeviceId, device.device_topic, body);
    await this.executeEffect(effect);
    await saveState(this.state);
    this.callbacks.onStateChange();
  }

  private async handleEvent(event: AnyProtocolEvent): Promise<void> {
    if (!this.config) return;
    const result = validateEvent(event, this.config.network_id);
    if (!result.valid) return;

    const { effects } = processEvent(this.state, result.event, this.config);
    await saveState(this.state);
    this.callbacks.onStateChange();

    for (const effect of effects) {
      await this.executeEffect(effect);
    }
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
