import type {
  AnyProtocolEvent,
  DeviceAnnounceEvent,
  DeviceConfig,
  DeviceLeaveEvent,
  DeviceRecord,
  LocalState,
  MessageRecord,
  MsgSendEvent,
} from "../protocol/types.js";

export type Effect =
  | { type: "publish"; topic: string; event: AnyProtocolEvent }
  | { type: "log"; message: string };

export interface ReducerResult {
  effects: Effect[];
  /** True if a new message was stored (caller should write to RS and notify). */
  newMessage: boolean;
}

export function processEvent(
  state: LocalState,
  event: AnyProtocolEvent,
  config: DeviceConfig,
): ReducerResult {
  switch (event.type) {
    case "device.announce":
      return handleDeviceAnnounce(state, event);
    case "device.leave":
      return handleDeviceLeave(state, event);
    case "msg.send":
      return handleMsgSend(state, event, config);
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
  if (!existing || event.timestamp >= existing.last_event_at) {
    state.devices.set(device_id, record);
  }
  return { effects: [], newMessage: false };
}

function handleDeviceLeave(state: LocalState, event: DeviceLeaveEvent): ReducerResult {
  const { device_id } = event.payload;
  const existing = state.devices.get(device_id);
  if (existing && event.timestamp >= existing.last_event_at) {
    existing.is_removed = true;
    existing.last_event_at = event.timestamp;
    existing.last_event_type = event.type;
  }
  return { effects: [], newMessage: false };
}

function handleMsgSend(
  state: LocalState,
  event: MsgSendEvent,
  config: DeviceConfig,
): ReducerResult {
  const { msg_id, attempt_id, to_device_id, body } = event.payload;

  if (to_device_id !== config.device_id) {
    return {
      effects: [{ type: "log", message: `ignoring msg.send not addressed to us: ${msg_id}` }],
      newMessage: false,
    };
  }

  // Dedup: if we already have this message (from RS load or prior ntfy delivery), skip.
  const existing = state.messages.get(msg_id);
  if (existing) {
    if (attempt_id > existing.last_attempt_id) {
      existing.last_attempt_id = attempt_id;
      existing.last_attempt_at = event.timestamp;
    }
    return { effects: [], newMessage: false };
  }

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

  return { effects: [], newMessage: true };
}
