import type { DeviceConfig } from "../../src/protocol/types.js";
import type { RSTokenData } from "./rs-sw.js";

const DB_NAME = "linkhop-lite";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // v1 stores — remove devices/messages (now owned by RS)
      if (db.objectStoreNames.contains("devices")) db.deleteObjectStore("devices");
      if (db.objectStoreNames.contains("messages")) db.deleteObjectStore("messages");
      if (db.objectStoreNames.contains("eventLog")) db.deleteObjectStore("eventLog");
      // v2 stores
      if (!db.objectStoreNames.contains("config")) db.createObjectStore("config");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode): IDBTransaction {
  return db.transaction(stores, mode);
}

// --- Browser config ---

export interface BrowserConfig {
  device: DeviceConfig;
  ntfy_url: string;
  self_send_enabled: boolean;
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

export async function loadConfig(): Promise<BrowserConfig | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readonly");
    const req = t.objectStore("config").get("browser");
    req.onsuccess = () => resolve((req.result as BrowserConfig | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

// --- RS token (written by main app, read by service worker) ---

export async function saveRSToken(data: RSTokenData): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readwrite");
    t.objectStore("config").put(data, "rs_token");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadRSToken(): Promise<RSTokenData | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readonly");
    const req = t.objectStore("config").get("rs_token");
    req.onsuccess = () => resolve((req.result as RSTokenData | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

// --- RS config (written by main app, read by service worker for background fetch) ---

export interface RSConfig {
  networkId: string;
  deviceId: string;
}

export async function saveRSConfig(config: RSConfig): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readwrite");
    t.objectStore("config").put(config, "rs_config");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadRSConfig(): Promise<RSConfig | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readonly");
    const req = t.objectStore("config").get("rs_config");
    req.onsuccess = () => resolve((req.result as RSConfig | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

// --- Reset ---

export async function clearAll(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = tx(db, "config", "readwrite");
    t.objectStore("config").clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
