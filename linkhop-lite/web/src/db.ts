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

export async function saveConfig(config: DeviceConfig): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readwrite");
    t.objectStore("config").put(config, "device");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadConfig(): Promise<DeviceConfig | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readonly");
    const req = t.objectStore("config").get("device");
    req.onsuccess = () => resolve((req.result as DeviceConfig) ?? null);
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
