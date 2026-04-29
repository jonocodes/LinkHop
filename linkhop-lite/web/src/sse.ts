import type { AnyProtocolEvent } from "../../src/protocol/types.js";

export interface SSECallbacks {
  onEvent: (event: AnyProtocolEvent) => void;
  onOpen?: () => void;
  onError?: (error: Event) => void;
}

/**
 * Subscribe to an ntfy topic via SSE.
 * Returns a cleanup function that closes the connection.
 */
export function subscribeSSE(
  ntfyUrl: string,
  topic: string,
  callbacks: SSECallbacks,
): () => void {
  const url = `${ntfyUrl}/${topic}/sse?since=12h`;
  const source = new EventSource(url);

  source.onopen = () => callbacks.onOpen?.();
  source.onerror = (e) => callbacks.onError?.(e);

  source.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data as string);
      // ntfy SSE wraps the message in {event: "message", message: "<json string>"}
      if (parsed.event === "message" && typeof parsed.message === "string") {
        try {
          callbacks.onEvent(JSON.parse(parsed.message) as AnyProtocolEvent);
        } catch { /* not JSON */ }
      } else if (parsed.type && parsed.event_id) {
        // Direct protocol event
        callbacks.onEvent(parsed as AnyProtocolEvent);
      }
    } catch { /* not JSON */ }
  };

  return () => source.close();
}

/** Publish a protocol event to an ntfy topic via HTTP POST. */
export async function publishHTTP(
  ntfyUrl: string,
  topic: string,
  event: AnyProtocolEvent,
): Promise<void> {
  const res = await fetch(`${ntfyUrl}/${topic}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = ` ${await res.text()}`; } catch { /* ignore */ }
    throw new Error(`publish failed: ${res.status} ${res.statusText}${detail}`.trim());
  }
}
