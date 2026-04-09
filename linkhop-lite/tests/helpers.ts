import type {
  AnyProtocolEvent,
  DeviceAnnounceEvent,
  DeviceConfig,
  DeviceLeaveEvent,
  DeviceRecord,
  MessageBody,
  MsgReceivedEvent,
  MsgSendEvent,
  SyncRequestEvent,
  SyncResponseEvent,
} from "../src/protocol/types.js";
import { deviceTopic } from "../src/protocol/topics.js";

let counter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${String(++counter).padStart(3, "0")}`;
}

export function resetIds(): void {
  counter = 0;
}

export function makeConfig(overrides: Partial<DeviceConfig> = {}): DeviceConfig {
  return {
    device_id: "dev_local",
    device_name: "Local Device",
    network_id: "net_test",
    env: "test",
    ...overrides,
  };
}

export function makePeerConfig(overrides: Partial<DeviceConfig> = {}): DeviceConfig {
  return {
    device_id: "dev_peer",
    device_name: "Peer Device",
    network_id: "net_test",
    env: "test",
    ...overrides,
  };
}

export function makeAnnounce(config: DeviceConfig, ts?: string): DeviceAnnounceEvent {
  return {
    type: "device.announce",
    timestamp: ts ?? "2026-04-04T18:00:00Z",
    network_id: config.network_id,
    event_id: nextId("evt"),
    from_device_id: config.device_id,
    payload: {
      device_id: config.device_id,
      device_name: config.device_name,
      device_topic: deviceTopic(config.env, config.network_id, config.device_id),
      protocol_version: "lite-v1",
    },
  };
}

export function makeLeave(config: DeviceConfig, ts?: string): DeviceLeaveEvent {
  return {
    type: "device.leave",
    timestamp: ts ?? "2026-04-04T18:05:00Z",
    network_id: config.network_id,
    event_id: nextId("evt"),
    from_device_id: config.device_id,
    payload: {
      device_id: config.device_id,
    },
  };
}

export function makeMsgSend(
  fromConfig: DeviceConfig,
  toDeviceId: string,
  opts: { msgId?: string; attemptId?: number; body?: MessageBody; ts?: string } = {},
): MsgSendEvent {
  return {
    type: "msg.send",
    timestamp: opts.ts ?? "2026-04-04T18:10:00Z",
    network_id: fromConfig.network_id,
    event_id: nextId("evt"),
    from_device_id: fromConfig.device_id,
    payload: {
      msg_id: opts.msgId ?? nextId("msg"),
      attempt_id: opts.attemptId ?? 1,
      to_device_id: toDeviceId,
      body: opts.body ?? { kind: "text", text: "hello" },
    },
  };
}

export function makeMsgReceived(
  fromConfig: DeviceConfig,
  msgId: string,
  toDeviceId: string,
  ts?: string,
): MsgReceivedEvent {
  return {
    type: "msg.received",
    timestamp: ts ?? "2026-04-04T18:10:03Z",
    network_id: fromConfig.network_id,
    event_id: nextId("evt"),
    from_device_id: fromConfig.device_id,
    payload: {
      msg_id: msgId,
      to_device_id: toDeviceId,
    },
  };
}

export function makeSyncRequest(
  fromConfig: DeviceConfig,
  toDeviceId: string,
  ts?: string,
): SyncRequestEvent {
  return {
    type: "sync.request",
    timestamp: ts ?? "2026-04-04T18:20:00Z",
    network_id: fromConfig.network_id,
    event_id: nextId("evt"),
    from_device_id: fromConfig.device_id,
    payload: {
      to_device_id: toDeviceId,
    },
  };
}

export function makeSyncResponse(
  fromConfig: DeviceConfig,
  toDeviceId: string,
  devices: DeviceRecord[],
  ts?: string,
): SyncResponseEvent {
  return {
    type: "sync.response",
    timestamp: ts ?? "2026-04-04T18:20:01Z",
    network_id: fromConfig.network_id,
    event_id: nextId("evt"),
    from_device_id: fromConfig.device_id,
    payload: {
      to_device_id: toDeviceId,
      devices,
    },
  };
}
