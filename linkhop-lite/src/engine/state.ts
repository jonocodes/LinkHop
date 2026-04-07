import type { DeviceRecord, EventLogEntry, LocalState, MessageRecord } from "../protocol/types.js";

export function createEmptyState(): LocalState {
  return {
    devices: new Map(),
    messages: new Map(),
    eventLog: [],
  };
}

export function getDevice(state: LocalState, deviceId: string): DeviceRecord | undefined {
  return state.devices.get(deviceId);
}

export function getMessage(state: LocalState, msgId: string): MessageRecord | undefined {
  return state.messages.get(msgId);
}

export function getInbox(state: LocalState, localDeviceId: string): MessageRecord[] {
  return [...state.messages.values()].filter(
    (m) => m.to_device_id === localDeviceId && m.state === "received",
  );
}

export function getPending(state: LocalState, localDeviceId: string): MessageRecord[] {
  return [...state.messages.values()].filter(
    (m) => m.from_device_id === localDeviceId && m.state === "pending",
  );
}

export function getSent(state: LocalState, localDeviceId: string): MessageRecord[] {
  return [...state.messages.values()].filter(
    (m) => m.from_device_id === localDeviceId && m.state === "received",
  );
}

export function getDevices(state: LocalState): DeviceRecord[] {
  return [...state.devices.values()];
}

export function appendEventLog(state: LocalState, entry: EventLogEntry): void {
  state.eventLog.push(entry);
}
