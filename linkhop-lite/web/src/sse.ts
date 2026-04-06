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
  baseUrl: string,
  topic: string,
  callbacks: SSECallbacks,
): () => void {
  const url = `${baseUrl}/${topic}/sse`;
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
 * Publish a protocol event to an ntfy topic.
 */
export async function publishHTTP(
  baseUrl: string,
  topic: string,
  event: AnyProtocolEvent,
): Promise<void> {
  const url = `${baseUrl}/${topic}`;
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(event),
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`ntfy publish failed: ${res.status} ${res.statusText}`);
  }
}
