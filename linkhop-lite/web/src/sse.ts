import type { AnyProtocolEvent, TransportKind } from "../../src/protocol/types.js";
import type { TransportKind as AppTransportKind } from "./db.js";

export interface SSECallbacks {
  onEvent: (event: AnyProtocolEvent) => void;
  onOpen?: () => void;
  onError?: (error: Event) => void;
}

function sseUrl(baseUrl: string, topic: string, kind: TransportKind, sinceId?: number): string {
  if (kind === "ntfy") {
    return `${baseUrl}/${topic}/sse?since=12h`;
  }
  // relay: cloudflare, supabase, local
  const params = new URLSearchParams();
  params.set("since", "12h");
  if (sinceId && sinceId > 0) {
    params.set("since_id", String(sinceId));
  }
  return `${baseUrl}/${topic}/sse?${params}`;
}

/**
 * Subscribe to an ntfy topic via SSE.
 * Returns a cleanup function that closes the connection.
 */
export function subscribeSSE(
  baseUrl: string,
  topic: string,
  callbacks: SSECallbacks,
  kind: TransportKind = "ntfy",
  sinceId?: number,
): () => void {
  const url = sseUrl(baseUrl, topic, kind, sinceId);
  const source = new EventSource(url);

  source.onopen = () => {
    callbacks.onOpen?.();
  };

  source.onerror = (e) => {
    callbacks.onError?.(e);
  };

  source.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data as string);
      // ntfy SSE sends full message objects; the protocol event is the message body
      if (parsed.event === "message" && typeof parsed.message === "string") {
        try {
          callbacks.onEvent(JSON.parse(parsed.message) as AnyProtocolEvent);
        } catch {
          // message content wasn't JSON, ignore
        }
      } else if (parsed.type && parsed.event_id) {
        // Direct protocol event (in case ntfy delivers raw JSON)
        callbacks.onEvent(parsed as AnyProtocolEvent);
      }
    } catch {
      // Not JSON, ignore
    }
  };

  return () => source.close();
}

/**
 * Publish a protocol event.
 * For ntfy: POST to topic, expects 200
 * For relay: POST to topic, expects 202 (async)
 */
export async function publishHTTP(
  baseUrl: string,
  topic: string,
  event: AnyProtocolEvent,
  kind: TransportKind = "ntfy",
): Promise<void> {
  const url = `${baseUrl}/${topic}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const text = await res.text();
      if (text) {
        detail = ` ${text}`;
      }
    } catch {
      // Ignore body read failures and fall back to status text.
    }
    throw new Error(`publish failed: ${res.status} ${res.statusText}${detail}`.trim());
  }
  // For relay backends, accept 202 as success (async)
  // For ntfy, accepts 200
  if (kind !== "ntfy" && res.status !== 202 && res.status !== 200) {
    throw new Error(`publish failed: ${res.status}`);
  }
}
