// Wire event types as defined in the implementation spec

export type EventType =
  | "device.announce"
  | "device.leave"
  | "msg.send"
  | "msg.received";

// --- Protocol Event Envelope ---

export interface ProtocolEvent<T extends EventType = EventType, P = unknown> {
  type: T;
  timestamp: string; // ISO-8601 UTC
  network_id: string;
  event_id: string;
  from_device_id: string;
  payload: P;
}

// --- Payload types ---

export interface DeviceAnnouncePayload {
  device_id: string;
  device_name: string;
  device_topic: string;
  protocol_version: string;
  capabilities?: string[];
}

export interface DeviceLeavePayload {
  device_id: string;
}

export interface TextBody {
  kind: "text";
  text: string;
}

export interface UrlBody {
  kind: "url";
  url: string;
  title?: string;
}

export interface EncryptedBody {
  kind: "encrypted";
  ciphertext: string;
  iv: string;
}

export type MessageBody = TextBody | UrlBody | EncryptedBody;

export interface MsgSendPayload {
  msg_id: string;
  attempt_id: number;
  to_device_id: string;
  body: MessageBody;
}

export interface MsgReceivedPayload {
  msg_id: string;
  to_device_id: string;
}

// --- Concrete event types ---

export type DeviceAnnounceEvent = ProtocolEvent<"device.announce", DeviceAnnouncePayload>;
export type DeviceLeaveEvent = ProtocolEvent<"device.leave", DeviceLeavePayload>;
export type MsgSendEvent = ProtocolEvent<"msg.send", MsgSendPayload>;
export type MsgReceivedEvent = ProtocolEvent<"msg.received", MsgReceivedPayload>;

export type AnyProtocolEvent =
  | DeviceAnnounceEvent
  | DeviceLeaveEvent
  | MsgSendEvent
  | MsgReceivedEvent;

// --- Local record shapes ---

export type MessageState = "pending" | "received" | "viewed";

export interface DeviceRecord {
  device_id: string;
  device_name: string;
  device_topic: string;
  last_event_at: string;
  last_event_type: EventType;
  is_removed: boolean;
  capabilities?: string[];
}

export interface MessageRecord {
  msg_id: string;
  from_device_id: string;
  to_device_id: string;
  body: MessageBody;
  created_at: string;
  state: MessageState;
  last_attempt_id: number;
  last_attempt_at: string;
  received_at: string | null;
  viewed_at: string | null;
}

export interface EventLogEntry {
  event_id: string;
  type: EventType;
  timestamp: string;
  from_device_id: string;
  direction: "incoming" | "outgoing";
  raw_event: AnyProtocolEvent;
}

// --- Local state ---

export interface LocalState {
  devices: Map<string, DeviceRecord>;
  messages: Map<string, MessageRecord>;
  eventLog: EventLogEntry[];
}

// --- Device config (local identity) ---

export interface DeviceConfig {
  device_id: string;
  device_name: string;
  network_id: string;
  env: string;
}
