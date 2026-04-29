/**
 * Lightweight RS client for service worker context.
 *
 * The remotestoragejs library cannot run inside a service worker (it depends on
 * DOM APIs for OAuth and the widget). This module makes raw HTTP requests to the
 * RS server using a bearer token stored in IDB by the main app thread.
 */

import type { MessageRecord } from "../../src/protocol/types.js";

const IDB_NAME = "linkhop-lite";
const IDB_VERSION = 2;
const RS_TOKEN_KEY = "rs_token";
const RS_CONFIG_KEY = "rs_config";
const RS_NOTIFIED_KEY = "rs_notified";
const MAX_NOTIFIED = 500;

export interface RSTokenData {
  href: string;   // RS storage root URL, e.g. https://storage.5apps.com/alice/
  token: string;  // Bearer token issued by OAuth
}

export interface RSConfig {
  networkId: string;
  deviceId: string;
}

export interface NewMessageNotification {
  record: MessageRecord;
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const t = db.transaction("config", "readonly");
    const req = t.objectStore("config").get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function loadRSToken(): Promise<RSTokenData | null> {
  try {
    const db = await openIDB();
    return idbGet<RSTokenData>(db, RS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function loadRSConfig(): Promise<RSConfig | null> {
  try {
    const db = await openIDB();
    return idbGet<RSConfig>(db, RS_CONFIG_KEY);
  } catch {
    return null;
  }
}

async function getNotifiedSet(db: IDBDatabase): Promise<Set<string>> {
  const arr = await idbGet<string[]>(db, RS_NOTIFIED_KEY);
  return new Set(arr ?? []);
}

async function saveNotifiedSet(db: IDBDatabase, ids: Set<string>): Promise<void> {
  const arr = [...ids].slice(-MAX_NOTIFIED);
  return new Promise((resolve, reject) => {
    const t = db.transaction("config", "readwrite");
    t.objectStore("config").put(arr, RS_NOTIFIED_KEY);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Mark a single msg_id as notified so background poll won't re-notify. */
export async function addNotifiedMsgId(msgId: string): Promise<void> {
  try {
    const db = await openIDB();
    const ids = await getNotifiedSet(db);
    ids.add(msgId);
    await saveNotifiedSet(db, ids);
  } catch {
    // best effort
  }
}

/** Write a message record to RS via raw HTTP PUT. Used by the SW on push receipt. */
export async function swPutMessage(
  networkId: string,
  record: MessageRecord,
): Promise<void> {
  const tokenData = await loadRSToken();
  if (!tokenData) return;
  const url = `${tokenData.href}linkhop/${networkId}/messages/${record.msg_id}`;
  await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${tokenData.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(record),
  });
}

interface RSDirectoryListing {
  items?: Record<string, unknown>;
}

/**
 * Poll RS for messages addressed to this device that haven't been notified yet.
 * Called from background sync and periodic sync handlers.
 * Returns messages that should trigger a notification.
 */
export async function swFetchNewMessages(): Promise<NewMessageNotification[]> {
  const [tokenData, rsConfig] = await Promise.all([loadRSToken(), loadRSConfig()]);
  if (!tokenData || !rsConfig) return [];

  const { href, token } = tokenData;
  const { networkId, deviceId } = rsConfig;
  const headers = { Authorization: `Bearer ${token}` };

  // Fetch directory listing
  let msgIds: string[];
  try {
    const res = await fetch(`${href}linkhop/${networkId}/messages/`, { headers });
    if (!res.ok) return [];
    const listing = await res.json() as RSDirectoryListing;
    msgIds = Object.keys(listing.items ?? {});
  } catch {
    return [];
  }

  if (msgIds.length === 0) return [];

  const db = await openIDB();
  const notified = await getNotifiedSet(db);

  // Only fetch msg IDs we haven't notified about yet (cap at 20 per poll)
  const toFetch = msgIds.filter((id) => !notified.has(id)).slice(0, 20);
  if (toFetch.length === 0) return [];

  const fetched = await Promise.allSettled(
    toFetch.map(async (id) => {
      const res = await fetch(`${href}linkhop/${networkId}/messages/${id}`, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json() as MessageRecord;
    }),
  );

  const newMessages: NewMessageNotification[] = [];
  for (const result of fetched) {
    if (result.status !== "fulfilled") continue;
    const record = result.value;
    if (record.to_device_id === deviceId && record.state !== "viewed") {
      newMessages.push({ record });
    }
  }

  // Mark all fetched IDs as seen regardless of whether we showed a notification
  // (avoids re-fetching messages that aren't for us or are already viewed)
  for (const id of toFetch) notified.add(id);
  await saveNotifiedSet(db, notified);

  return newMessages;
}
