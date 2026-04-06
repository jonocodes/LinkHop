import type { AnyProtocolEvent } from "./types.js";

export type ValidationResult =
  | { valid: true; event: AnyProtocolEvent }
  | { valid: false; reason: string };

function hasString(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === "string" && (obj[key] as string).length > 0;
}

export function validateEvent(raw: unknown, expectedNetworkId: string): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, reason: "event is not an object" };
  }

  const obj = raw as Record<string, unknown>;

  // Envelope fields
  for (const field of ["type", "timestamp", "network_id", "event_id", "from_device_id"]) {
    if (!hasString(obj, field)) {
      return { valid: false, reason: `missing or empty envelope field: ${field}` };
    }
  }

  if (obj.network_id !== expectedNetworkId) {
    return { valid: false, reason: `network_id mismatch: expected ${expectedNetworkId}, got ${obj.network_id}` };
  }

  if (typeof obj.payload !== "object" || obj.payload === null) {
    return { valid: false, reason: "missing or invalid payload" };
  }

  const payload = obj.payload as Record<string, unknown>;
  const type = obj.type as string;

  switch (type) {
    case "device.announce":
      for (const f of ["device_id", "device_name", "device_topic", "protocol_version"]) {
        if (!hasString(payload, f)) {
          return { valid: false, reason: `device.announce missing payload field: ${f}` };
        }
      }
      break;

    case "device.leave":
      if (!hasString(payload, "device_id")) {
        return { valid: false, reason: "device.leave missing payload field: device_id" };
      }
      break;

    case "msg.send":
      for (const f of ["msg_id", "to_device_id"]) {
        if (!hasString(payload, f)) {
          return { valid: false, reason: `msg.send missing payload field: ${f}` };
        }
      }
      if (typeof payload.attempt_id !== "number") {
        return { valid: false, reason: "msg.send missing payload field: attempt_id" };
      }
      if (typeof payload.body !== "object" || payload.body === null) {
        return { valid: false, reason: "msg.send missing payload field: body" };
      }
      break;

    case "msg.received":
      for (const f of ["msg_id", "to_device_id"]) {
        if (!hasString(payload, f)) {
          return { valid: false, reason: `msg.received missing payload field: ${f}` };
        }
      }
      break;

    default:
      return { valid: false, reason: `unknown event type: ${type}` };
  }

  return { valid: true, event: raw as AnyProtocolEvent };
}
