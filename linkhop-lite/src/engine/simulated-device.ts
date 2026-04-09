import type { AnyProtocolEvent, DeviceConfig, LocalState, MessageBody } from "../protocol/types.js";
import { validateEvent } from "../protocol/validate.js";
import { registryTopicFromConfig, deviceTopicFromConfig } from "../protocol/topics.js";
import { createEmptyState } from "./state.js";
import { processEvent } from "./reducer.js";
import { actionAnnounce, actionHeartbeat, actionLeave, actionSend, actionSyncRequest } from "./actions.js";
import type { Effect } from "./reducer.js";
import type { InMemoryRelay } from "./relay.js";

/**
 * A simulated device connected to an InMemoryRelay.
 * Subscribes to registry + device topics, processes incoming events through
 * the engine, and publishes outgoing effects back to the relay.
 */
export class SimulatedDevice {
  readonly config: DeviceConfig;
  readonly state: LocalState;
  private relay: InMemoryRelay;
  private unsubscribes: (() => void)[] = [];

  /** All effects this device has executed, for test assertions */
  effectLog: Effect[] = [];

  constructor(config: DeviceConfig, relay: InMemoryRelay) {
    this.config = config;
    this.state = createEmptyState();
    this.relay = relay;
  }

  /** Subscribe to registry and device topics on the relay */
  connect(): void {
    const regTopic = registryTopicFromConfig(this.config);
    const devTopic = deviceTopicFromConfig(this.config);

    this.unsubscribes.push(
      this.relay.subscribe(regTopic, (event) => this.handleEvent(event)),
      this.relay.subscribe(devTopic, (event) => this.handleEvent(event)),
    );
  }

  /** Unsubscribe from all topics */
  disconnect(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
  }

  /** Emit device.announce */
  announce(): void {
    const effect = actionAnnounce(this.config);
    this.executeEffect(effect);
  }

  /** Emit device.leave */
  leave(): void {
    const effect = actionLeave(this.config);
    this.executeEffect(effect);
  }

  /** Emit device.heartbeat */
  heartbeat(): void {
    const effect = actionHeartbeat(this.config);
    this.executeEffect(effect);
  }

  /** Request sync from a peer */
  syncRequest(toDeviceId: string, toDeviceTopic: string): void {
    const effect = actionSyncRequest(this.config, toDeviceId, toDeviceTopic);
    this.executeEffect(effect);
  }

  /** Send a text message to a peer */
  send(toDeviceId: string, toDeviceTopic: string, body: MessageBody): void {
    const effect = actionSend(this.state, this.config, toDeviceId, toDeviceTopic, body);
    this.executeEffect(effect);
  }

  private handleEvent(event: AnyProtocolEvent): void {
    const result = validateEvent(event, this.config.network_id);
    if (!result.valid) return;

    const { effects } = processEvent(this.state, result.event, this.config);
    for (const effect of effects) {
      this.executeEffect(effect);
    }
  }

  private executeEffect(effect: Effect): void {
    this.effectLog.push(effect);
    if (effect.type === "publish") {
      this.relay.publish(effect.topic, effect.event);
    }
  }
}
