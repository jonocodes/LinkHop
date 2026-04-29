import RemoteStorage from "remotestoragejs";
import type { DeviceRecord, MessageRecord, ReceiptRecord } from "../../src/protocol/types.js";

export interface RSSettings {
  network_secret: string;
  encryption_enabled: boolean;
  poll_interval_seconds: number;
  message_cull_days: number;
}

export const DEFAULT_SETTINGS: RSSettings = {
  network_secret: "",
  encryption_enabled: false,
  poll_interval_seconds: 600,
  message_cull_days: 30,
};

// RS JSON schema type tags
const T_SETTINGS = "linkhop-settings";
const T_DEVICE = "linkhop-device";
const T_MESSAGE = "linkhop-message";
const T_RECEIPT = "linkhop-receipt";

export type RSChangeEvent = {
  path: string;
  origin: "local" | "window" | "remote" | "conflict";
  oldValue: unknown;
  newValue: unknown;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RSClient = any;

// Path helpers
// Per-device layout keeps each device's data isolated:
//   {networkId}/device/{deviceId}/inbox/{msgId}     — messages TO this device
//   {networkId}/device/{deviceId}/sent/{msgId}      — messages FROM this device
//   {networkId}/device/{deviceId}/receipts/{msgId}  — delivery receipts for sent messages
function inboxPath(networkId: string, deviceId: string) {
  return `${networkId}/device/${deviceId}/inbox/`;
}
function sentPath(networkId: string, deviceId: string) {
  return `${networkId}/device/${deviceId}/sent/`;
}
function receiptsPath(networkId: string, deviceId: string) {
  return `${networkId}/device/${deviceId}/receipts/`;
}

export class RSStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rs: any;
  private client: RSClient;

  constructor() {
    this.rs = new RemoteStorage({
      changeEvents: { local: true, window: true, remote: true, conflict: true },
    });
    this.rs.access.claim("linkhop", "rw");
    this.rs.caching.enable("/linkhop/");
    this.client = this.rs.scope("/linkhop/");
  }

  // --- Lifecycle ---

  onConnected(cb: (rsUser: string) => void): void {
    this.rs.on("connected", () => cb(this.rs.remote.userAddress as string));
  }

  onDisconnected(cb: () => void): void {
    this.rs.on("disconnected", cb);
  }

  onError(cb: (err: Error) => void): void {
    this.rs.on("error", cb);
  }

  onChange(cb: (event: RSChangeEvent) => void): void {
    this.client.on("change", cb);
  }

  isConnected(): boolean {
    return this.rs.connected as boolean;
  }

  getUserAddress(): string | null {
    return (this.rs.remote?.userAddress as string | undefined) ?? null;
  }

  /** Storage root URL — needed by the service worker for raw HTTP writes. */
  getStorageHref(): string | null {
    return (this.rs.remote?.href as string | undefined) ?? null;
  }

  /** Current bearer token — needed by the service worker for raw HTTP writes. */
  getToken(): string | null {
    return (this.rs.remote?.token as string | undefined) ?? null;
  }

  /** Trigger OAuth connect flow for the given RS user address. */
  connect(userAddress: string): void {
    this.rs.connect(userAddress);
  }

  disconnect(): void {
    this.rs.disconnect();
  }

  // --- Settings ---

  async getSettings(): Promise<RSSettings | null> {
    const result = await this.client.getObject("settings") as RSSettings | null;
    return result ?? null;
  }

  async saveSettings(settings: RSSettings): Promise<void> {
    await this.client.storeObject(T_SETTINGS, "settings", settings);
  }

  // --- Devices ---

  async listDevices(networkId: string): Promise<DeviceRecord[]> {
    const result = await this.client.getAll(`${networkId}/devices/`) as Record<string, DeviceRecord> | null;
    if (!result) return [];
    return Object.values(result);
  }

  async upsertDevice(networkId: string, record: DeviceRecord): Promise<void> {
    await this.client.storeObject(T_DEVICE, `${networkId}/devices/${record.device_id}`, record);
  }

  async markDeviceRemoved(networkId: string, deviceId: string, timestamp: string): Promise<void> {
    const existing = await this.client.getObject(`${networkId}/devices/${deviceId}`) as DeviceRecord | null;
    if (!existing) return;
    await this.client.storeObject(T_DEVICE, `${networkId}/devices/${deviceId}`, {
      ...existing,
      is_removed: true,
      last_event_at: timestamp,
      last_event_type: "device.leave",
    });
  }

  // --- Inbox (messages TO this device) ---

  async listInbox(networkId: string, deviceId: string): Promise<MessageRecord[]> {
    const result = await this.client.getAll(inboxPath(networkId, deviceId)) as Record<string, MessageRecord> | null;
    if (!result) return [];
    return Object.values(result);
  }

  async upsertInboxMessage(networkId: string, deviceId: string, record: MessageRecord): Promise<void> {
    await this.client.storeObject(T_MESSAGE, `${inboxPath(networkId, deviceId)}${record.msg_id}`, record);
    this.scheduleCull(networkId, deviceId);
  }

  async updateInboxMessageState(
    networkId: string,
    deviceId: string,
    msgId: string,
    state: "received" | "viewed",
    timestamp: string,
  ): Promise<void> {
    const path = `${inboxPath(networkId, deviceId)}${msgId}`;
    const existing = await this.client.getObject(path) as MessageRecord | null;
    if (!existing) return;
    await this.client.storeObject(T_MESSAGE, path, {
      ...existing,
      state,
      received_at: state === "received" ? timestamp : existing.received_at,
      viewed_at: state === "viewed" ? timestamp : existing.viewed_at,
    });
  }

  // --- Sent (messages FROM this device) ---

  async listSent(networkId: string, deviceId: string): Promise<MessageRecord[]> {
    const result = await this.client.getAll(sentPath(networkId, deviceId)) as Record<string, MessageRecord> | null;
    if (!result) return [];
    return Object.values(result);
  }

  async upsertSentMessage(networkId: string, deviceId: string, record: MessageRecord): Promise<void> {
    await this.client.storeObject(T_MESSAGE, `${sentPath(networkId, deviceId)}${record.msg_id}`, record);
    this.scheduleCull(networkId, deviceId);
  }

  async updateSentMessageState(
    networkId: string,
    deviceId: string,
    msgId: string,
    state: "received" | "viewed",
    timestamp: string,
  ): Promise<void> {
    const path = `${sentPath(networkId, deviceId)}${msgId}`;
    const existing = await this.client.getObject(path) as MessageRecord | null;
    if (!existing) return;
    await this.client.storeObject(T_MESSAGE, path, {
      ...existing,
      state,
      received_at: state === "received" ? timestamp : existing.received_at,
    });
  }

  // --- Receipts (delivery confirmations for sent messages) ---

  async listReceipts(networkId: string, deviceId: string): Promise<ReceiptRecord[]> {
    const result = await this.client.getAll(receiptsPath(networkId, deviceId)) as Record<string, ReceiptRecord> | null;
    if (!result) return [];
    return Object.values(result);
  }

  async upsertReceipt(networkId: string, deviceId: string, record: ReceiptRecord): Promise<void> {
    await this.client.storeObject(T_RECEIPT, `${receiptsPath(networkId, deviceId)}${record.msg_id}`, record);
  }

  // --- Culling ---

  /** Delete messages and receipts older than cullDays for this device's three directories. */
  async cullDevice(networkId: string, deviceId: string, cullDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - cullDays * 24 * 60 * 60 * 1000).toISOString();

    const [inbox, sent, receipts] = await Promise.all([
      this.listInbox(networkId, deviceId),
      this.listSent(networkId, deviceId),
      this.listReceipts(networkId, deviceId),
    ]);

    const removals: Promise<void>[] = [];
    for (const m of inbox) {
      if (m.created_at < cutoff) removals.push(this.client.remove(`${inboxPath(networkId, deviceId)}${m.msg_id}`));
    }
    for (const m of sent) {
      if (m.created_at < cutoff) removals.push(this.client.remove(`${sentPath(networkId, deviceId)}${m.msg_id}`));
    }
    for (const r of receipts) {
      if (r.received_at < cutoff) removals.push(this.client.remove(`${receiptsPath(networkId, deviceId)}${r.msg_id}`));
    }
    await Promise.all(removals);
  }

  private scheduleCull(networkId: string, deviceId: string): void {
    this.getSettings().then((s) => {
      const days = s?.message_cull_days ?? DEFAULT_SETTINGS.message_cull_days;
      this.cullDevice(networkId, deviceId, days).catch(() => {});
    }).catch(() => {});
  }
}
