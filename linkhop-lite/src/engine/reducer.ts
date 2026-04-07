import type {
  AnyProtocolEvent,
  DeviceAnnounceEvent,
  DeviceConfig,
  DeviceLeaveEvent,
  DeviceRecord,
  EventLogEntry,
  LocalState,
  MessageRecord,
  MsgReceivedEvent,
  MsgSendEvent,
} from "../protocol/types.js";
import { createMsgReceived } from "../protocol/events.js";

// An effect the engine wants the transport layer to perform
export type Effect =
  | { type: "publish"; topic: string; event: AnyProtocolEvent }
  | { type: "log"; message: string };

export interface ReducerResult {
  effects: Effect[];
}

export function processEvent(
  state: LocalState,
  event: AnyProtocolEvent,
  config: DeviceConfig,
): ReducerResult {
  const entry: EventLogEntry = {
    event_id: event.event_id,
    type: event.type,
    timestamp: event.timestamp,
    from_device_id: event.from_device_id,
    direction: "incoming",
    raw_event: event,
  };
  state.eventLog.push(entry);

  switch (event.type) {
    case "device.announce":
      return handleDeviceAnnounce(state, event);
    case "device.leave":
      return handleDeviceLeave(state, event);
    case "msg.send":
      return handleMsgSend(state, event, config);
    case "msg.received":
      return handleMsgReceived(state, event, config);
  }
}

function handleDeviceAnnounce(state: LocalState, event: DeviceAnnounceEvent): ReducerResult {
  const { device_id, device_name, device_topic, capabilities } = event.payload;

  const existing = state.devices.get(device_id);
  const record: DeviceRecord = {
    device_id,
    device_name,
    device_topic,
    last_event_at: event.timestamp,
    last_event_type: event.type,
    is_removed: false,
    capabilities,
  };

  // If device was previously removed, re-announce clears that
  if (existing?.is_removed) {
    record.is_removed = false;
  }

  state.devices.set(device_id, record);
  return { effects: [] };
}

function handleDeviceLeave(state: LocalState, event: DeviceLeaveEvent): ReducerResult {
  const { device_id } = event.payload;
  const existing = state.devices.get(device_id);

  if (existing) {
    existing.is_removed = true;
    existing.last_event_at = event.timestamp;
    existing.last_event_type = event.type;
  }

  return { effects: [] };
}

function handleMsgSend(
  state: LocalState,
  event: MsgSendEvent,
  config: DeviceConfig,
): ReducerResult {
  const { msg_id, attempt_id, to_device_id, body } = event.payload;

  // Ignore if not addressed to us
  if (to_device_id !== config.device_id) {
    return { effects: [{ type: "log", message: `ignoring msg.send not addressed to us: ${msg_id}` }] };
  }

  const existing = state.messages.get(msg_id);
  const isDuplicate = existing !== undefined;

  if (!isDuplicate) {
    // Store new message as received
    const record: MessageRecord = {
      msg_id,
      from_device_id: event.from_device_id,
      to_device_id,
      body,
      created_at: event.timestamp,
      state: "received",
      last_attempt_id: attempt_id,
      last_attempt_at: event.timestamp,
      received_at: event.timestamp,
      viewed_at: null,
    };
    state.messages.set(msg_id, record);
  } else {
    // Update attempt tracking on duplicate
    existing.last_attempt_id = attempt_id;
    existing.last_attempt_at = event.timestamp;
  }

  // Look up sender device to find their topic for the ack
  const senderDevice = state.devices.get(event.from_device_id);
  if (!senderDevice) {
    return {
      effects: [{
        type: "log",
        message: `received msg.send from unknown device ${event.from_device_id}, cannot ack`,
      }],
    };
  }

  // Emit msg.received (even on duplicate, per spec)
  const ack = createMsgReceived(config, msg_id, event.from_device_id, senderDevice.device_topic);

  return {
    effects: [{ type: "publish", topic: ack.topic, event: ack.event }],
  };
}

function handleMsgReceived(
  state: LocalState,
  event: MsgReceivedEvent,
  config: DeviceConfig,
): ReducerResult {
  const { msg_id, to_device_id } = event.payload;

  // to_device_id in msg.received points to the original sender (us)
  if (to_device_id !== config.device_id) {
    return { effects: [{ type: "log", message: `ignoring msg.received not for us: ${msg_id}` }] };
  }

  const existing = state.messages.get(msg_id);
  if (!existing) {
    return { effects: [{ type: "log", message: `received ack for unknown message: ${msg_id}` }] };
  }

  if (existing.state === "pending") {
    existing.state = "received";
    existing.received_at = event.timestamp;
  }

  return { effects: [] };
}
