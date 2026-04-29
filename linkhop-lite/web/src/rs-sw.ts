/**
 * Lightweight RS client for service worker context.
 *
 * The remotestoragejs library cannot run inside a service worker (it depends on
 * DOM APIs for OAuth and the widget). This module makes raw HTTP requests to the
 * RS server using a bearer token stored in IDB by the main app thread.
 */

import type { MessageRecord, ReceiptRecord } from "../../src/protocol/types.js";

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

function rsHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function inboxUrl(href: string, networkId: string, deviceId: string, msgId: string) {
  return `${href}linkhop/${networkId}/device/${deviceId}/inbox/${msgId}`;
}

function receiptsUrl(href: string, networkId: string, senderDeviceId: string, msgId: string) {
  return `${href}linkhop/${networkId}/device/${senderDeviceId}/receipts/${msgId}`;
}

/**
 * Write a received message to this device's RS inbox.
 * Called by the push handler when a msg.send push arrives.
 */
export async function swPutInboxMessage(
  networkId: string,
  deviceId: string,
  record: MessageRecord,
): Promise<void> {
  const tokenData = await loadRSToken();
  if (!tokenData) return;
  await fetch(inboxUrl(tokenData.href, networkId, deviceId, record.msg_id), {
    method: "PUT",
    headers: rsHeaders(tokenData.token),
    body: JSON.stringify(record),
  });
}

/**
 * Write a delivery receipt to the sender's RS receipts directory.
 * Called after writing the inbox message so the sender can detect delivery.
 */
export async function swPutReceipt(
  networkId: string,
  senderDeviceId: string,
  msgId: string,
  receivedAt: string,
  fromDeviceId: string,
): Promise<void> {
  const tokenData = await loadRSToken();
  if (!tokenData) return;
  const receipt: ReceiptRecord = { msg_id: msgId, received_at: receivedAt, from_device_id: fromDeviceId };
  await fetch(receiptsUrl(tokenData.href, networkId, senderDeviceId, msgId), {
    method: "PUT",
    headers: rsHeaders(tokenData.token),
    body: JSON.stringify(receipt),
  });
}

interface RSDirectoryListing {
  items?: Record<string, unknown>;
}

/**
 * Poll this device's RS inbox for messages not yet notified.
 * Called from background sync and periodic sync handlers.
 * Also writes receipts back to each sender so they see delivery confirmation.
 */
export async function swFetchNewMessages(): Promise<NewMessageNotification[]> {
  const [tokenData, rsConfig] = await Promise.all([loadRSToken(), loadRSConfig()]);
  if (!tokenData || !rsConfig) return [];

  const { href, token } = tokenData;
  const { networkId, deviceId } = rsConfig;
  const headers = { Authorization: `Bearer ${token}` };

  // Only read this device's inbox — not the whole network
  const listUrl = `${href}linkhop/${networkId}/device/${deviceId}/inbox/`;
  let msgIds: string[];
  try {
    const res = await fetch(listUrl, { headers });
    if (!res.ok) return [];
    const listing = await res.json() as RSDirectoryListing;
    msgIds = Object.keys(listing.items ?? {});
  } catch {
    return [];
  }

  if (msgIds.length === 0) return [];

  const db = await openIDB();
  const notified = await getNotifiedSet(db);

  const toFetch = msgIds.filter((id) => !notified.has(id)).slice(0, 20);
  if (toFetch.length === 0) return [];

  const fetched = await Promise.allSettled(
    toFetch.map(async (id) => {
      const res = await fetch(inboxUrl(href, networkId, deviceId, id), { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json() as MessageRecord;
    }),
  );

  const now = new Date().toISOString();
  const newMessages: NewMessageNotification[] = [];

  for (const result of fetched) {
    if (result.status !== "fulfilled") continue;
    const record = result.value;
    if (record.state !== "viewed") {
      newMessages.push({ record });
      // Write receipt to sender's receipts directory (best effort)
      swPutReceipt(networkId, record.from_device_id, record.msg_id, now, deviceId).catch(() => {});
    }
  }

  for (const id of toFetch) notified.add(id);
  await saveNotifiedSet(db, notified);

  return newMessages;
}
