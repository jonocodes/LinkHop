import type {
  DeviceConfig,
  DeviceRecord,
  EventLogEntry,
  LocalState,
  MessageRecord,
} from "../../src/protocol/types.js";
import { createEmptyState } from "../../src/engine/state.js";

const DB_NAME = "linkhop-lite";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config");
      }
      if (!db.objectStoreNames.contains("devices")) {
        db.createObjectStore("devices", { keyPath: "device_id" });
      }
      if (!db.objectStoreNames.contains("messages")) {
        db.createObjectStore("messages", { keyPath: "msg_id" });
      }
      if (!db.objectStoreNames.contains("eventLog")) {
        db.createObjectStore("eventLog", { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  return db.transaction(stores, mode);
}

// --- Config ---

export type TransportKind = "ntfy" | "relay" | "cloudflare" | "supabase";

export interface TransportConfig {
  kind: TransportKind;
  url: string;
  description: string;
}

export const TRANSPORTS: TransportConfig[] = [
  { kind: "ntfy", url: "https://ntfy.sh", description: "Free hosted (30d retention)" },
  { kind: "ntfy", url: "https://your-ntfy.example.com", description: "Self-hosted ntfy" },
  { kind: "relay", url: "http://localhost:8000", description: "Local Deno relay" },
  { kind: "supabase", url: "https://your-project.supabase.co", description: "Supabase Edge Function" },
  { kind: "cloudflare", url: "https://your-worker.workers.dev", description: "Cloudflare Worker" },
];

export interface BrowserConfig {
  device: DeviceConfig;
  transport_kind: TransportKind;
  transport_url: string;
  ntfy_url?: string; // legacy compatibility
  pool?: string;
  password?: string;
  encryption_enabled?: boolean;
  self_send_enabled?: boolean;
}

export async function saveConfig(config: BrowserConfig): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readwrite");
    t.objectStore("config").put(config, "browser");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function normalizeConfig(raw: Partial<BrowserConfig> & { device: DeviceConfig }): BrowserConfig {
  const kind = raw.transport_kind ?? "ntfy";
  const url = raw.transport_url ?? raw.ntfy_url ?? "https://ntfy.sh";
  return {
    device: raw.device,
    transport_kind: kind,
    transport_url: url,
    ntfy_url: raw.ntfy_url,
    pool: raw.pool,
    password: raw.password,
    encryption_enabled: raw.encryption_enabled,
    self_send_enabled: raw.self_send_enabled,
  };
}

export async function loadConfig(): Promise<BrowserConfig | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readonly");
    const req = t.objectStore("config").get("browser");
    req.onsuccess = () => {
      const result = req.result;
      if (!result) {
        // Try legacy key
        const legacyReq = tx(db, "config", "readonly").objectStore("config").get("device");
        legacyReq.onsuccess = () => {
          if (legacyReq.result) {
            resolve(normalizeConfig({ device: legacyReq.result as DeviceConfig, ntfy_url: "https://ntfy.sh" }));
          } else {
            resolve(null);
          }
        };
        legacyReq.onerror = () => reject(legacyReq.error);
      } else {
        resolve(normalizeConfig(result as BrowserConfig));
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// --- State ---

export async function loadState(): Promise<LocalState> {
  const db = await openDB();
  const state = createEmptyState();

  // Load devices
  const devices: DeviceRecord[] = await new Promise((resolve, reject) => {
    const t = tx(db, "devices", "readonly");
    const req = t.objectStore("devices").getAll();
    req.onsuccess = () => resolve(req.result as DeviceRecord[]);
    req.onerror = () => reject(req.error);
  });
  for (const d of devices) state.devices.set(d.device_id, d);

  // Load messages
  const messages: MessageRecord[] = await new Promise((resolve, reject) => {
    const t = tx(db, "messages", "readonly");
    const req = t.objectStore("messages").getAll();
    req.onsuccess = () => resolve(req.result as MessageRecord[]);
    req.onerror = () => reject(req.error);
  });
  for (const m of messages) state.messages.set(m.msg_id, m);

  return state;
}

export async function saveState(state: LocalState): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, ["devices", "messages", "eventLog"], "readwrite");

    // Clear and re-write devices
    const deviceStore = t.objectStore("devices");
    deviceStore.clear();
    for (const d of state.devices.values()) deviceStore.put(d);

    // Clear and re-write messages
    const msgStore = t.objectStore("messages");
    msgStore.clear();
    for (const m of state.messages.values()) msgStore.put(m);

    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadSeenEventIds(): Promise<Set<string>> {
  const db = await openDB();
  const entries: EventLogEntry[] = await new Promise((resolve, reject) => {
    const t = tx(db, "eventLog", "readonly");
    const req = t.objectStore("eventLog").getAll();
    req.onsuccess = () => resolve(req.result as EventLogEntry[]);
    req.onerror = () => reject(req.error);
  });
  return new Set(entries.map((e) => e.event_id));
}

export async function appendEvents(entries: EventLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "eventLog", "readwrite");
    const store = t.objectStore("eventLog");
    for (const e of entries) store.add(e);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, ["config", "devices", "messages", "eventLog"], "readwrite");
    t.objectStore("config").clear();
    t.objectStore("devices").clear();
    t.objectStore("messages").clear();
    t.objectStore("eventLog").clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadBackgroundHeartbeatLastTriggeredAt(): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readonly");
    const req = t.objectStore("config").get("bg_heartbeat_last_trigger_at");
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}
