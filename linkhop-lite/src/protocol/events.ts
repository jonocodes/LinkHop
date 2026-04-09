import type {
  DeviceAnnounceEvent,
  DeviceConfig,
  DeviceLeaveEvent,
  DeviceRecord,
  MessageBody,
  MsgReceivedEvent,
  MsgSendEvent,
  SyncRequestEvent,
  SyncResponseEvent,
} from "./types.js";
import { generateEventId, generateMsgId } from "./ids.js";
import { deviceTopicFromConfig } from "./topics.js";

const PROTOCOL_VERSION = "lite-v1";

function now(): string {
  return new Date().toISOString();
}

export function createDeviceAnnounce(
  config: DeviceConfig,
  capabilities?: string[],
): DeviceAnnounceEvent {
  return {
    type: "device.announce",
    timestamp: now(),
    network_id: config.network_id,
    event_id: generateEventId(),
    from_device_id: config.device_id,
    payload: {
      device_id: config.device_id,
      device_name: config.device_name,
      device_topic: deviceTopicFromConfig(config),
      protocol_version: PROTOCOL_VERSION,
      ...(capabilities?.length ? { capabilities } : {}),
    },
  };
}

export function createDeviceLeave(config: DeviceConfig): DeviceLeaveEvent {
  return {
    type: "device.leave",
    timestamp: now(),
    network_id: config.network_id,
    event_id: generateEventId(),
    from_device_id: config.device_id,
    payload: {
      device_id: config.device_id,
    },
  };
}

export function createMsgSend(
  config: DeviceConfig,
  toDeviceId: string,
  toDeviceTopic: string,
  body: MessageBody,
  msgId?: string,
  attemptId?: number,
): { event: MsgSendEvent; topic: string } {
  return {
    event: {
      type: "msg.send",
      timestamp: now(),
      network_id: config.network_id,
      event_id: generateEventId(),
      from_device_id: config.device_id,
      payload: {
        msg_id: msgId ?? generateMsgId(),
        attempt_id: attemptId ?? 1,
        to_device_id: toDeviceId,
        body,
      },
    },
    topic: toDeviceTopic,
  };
}

export function createMsgReceived(
  config: DeviceConfig,
  msgId: string,
  originalSenderDeviceId: string,
  originalSenderDeviceTopic: string,
): { event: MsgReceivedEvent; topic: string } {
  return {
    event: {
      type: "msg.received",
      timestamp: now(),
      network_id: config.network_id,
      event_id: generateEventId(),
      from_device_id: config.device_id,
      payload: {
        msg_id: msgId,
        to_device_id: originalSenderDeviceId,
      },
    },
    topic: originalSenderDeviceTopic,
  };
}

export function createSyncRequest(
  config: DeviceConfig,
  toDeviceId: string,
  toDeviceTopic: string,
): { event: SyncRequestEvent; topic: string } {
  return {
    event: {
      type: "sync.request",
      timestamp: now(),
      network_id: config.network_id,
      event_id: generateEventId(),
      from_device_id: config.device_id,
      payload: {
        to_device_id: toDeviceId,
      },
    },
    topic: toDeviceTopic,
  };
}

export function createSyncResponse(
  config: DeviceConfig,
  toDeviceId: string,
  toDeviceTopic: string,
  devices: DeviceRecord[],
): { event: SyncResponseEvent; topic: string } {
  return {
    event: {
      type: "sync.response",
      timestamp: now(),
      network_id: config.network_id,
      event_id: generateEventId(),
      from_device_id: config.device_id,
      payload: {
        to_device_id: toDeviceId,
        devices,
      },
    },
    topic: toDeviceTopic,
  };
}
