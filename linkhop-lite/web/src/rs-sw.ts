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

export interface RSTokenData {
  href: string;   // RS storage root URL, e.g. https://storage.5apps.com/alice/
  token: string;  // Bearer token issued by OAuth
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadRSToken(): Promise<RSTokenData | null> {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("config", "readonly");
      const req = tx.objectStore("config").get(RS_TOKEN_KEY);
      req.onsuccess = () => resolve((req.result as RSTokenData | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
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
