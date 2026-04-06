import { randomBytes } from "node:crypto";

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function generateDeviceId(): string {
  return `dev_${randomHex(6)}`;
}

export function generateEventId(): string {
  return `evt_${randomHex(6)}`;
}

export function generateMsgId(): string {
  return `msg_${randomHex(6)}`;
}

export function generateNetworkId(): string {
  return `net_${randomHex(6)}`;
}
