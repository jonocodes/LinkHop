import type {
  DeviceConfig,
  LocalState,
  MessageBody,
  MessageRecord,
} from "../protocol/types.js";
import {
  createDeviceAnnounce,
  createDeviceLeave,
  createMsgSend,
  createSyncRequest,
} from "../protocol/events.js";
import { registryTopicFromConfig } from "../protocol/topics.js";
import type { Effect } from "./reducer.js";

/**
 * Local actions initiated by this device.
 * These produce effects (events to publish) and update local state.
 */

export function actionAnnounce(config: DeviceConfig, capabilities?: string[]): Effect {
  const event = createDeviceAnnounce(config, capabilities);
  return { type: "publish", topic: registryTopicFromConfig(config), event };
}

export function actionLeave(config: DeviceConfig): Effect {
  const event = createDeviceLeave(config);
  return { type: "publish", topic: registryTopicFromConfig(config), event };
}

export function actionMarkViewed(state: LocalState, msgId: string): void {
  const msg = state.messages.get(msgId);
  if (msg && msg.state === "received") {
    msg.state = "viewed";
    msg.viewed_at = new Date().toISOString();
  }
}

export function actionSend(
  state: LocalState,
  config: DeviceConfig,
  toDeviceId: string,
  toDeviceTopic: string,
  body: MessageBody,
): Effect {
  const { event, topic } = createMsgSend(config, toDeviceId, toDeviceTopic, body);

  // Store locally as pending
  const record: MessageRecord = {
    msg_id: event.payload.msg_id,
    from_device_id: config.device_id,
    to_device_id: toDeviceId,
    body,
    created_at: event.timestamp,
    state: "pending",
    last_attempt_id: event.payload.attempt_id,
    last_attempt_at: event.timestamp,
    received_at: null,
    viewed_at: null,
  };
  state.messages.set(record.msg_id, record);

  return { type: "publish", topic, event };
}

export function actionSyncRequest(
  config: DeviceConfig,
  toDeviceId: string,
  toDeviceTopic: string,
): Effect {
  const { event, topic } = createSyncRequest(config, toDeviceId, toDeviceTopic);
  return { type: "publish", topic, event };
}
