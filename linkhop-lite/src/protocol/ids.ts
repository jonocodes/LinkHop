function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
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
