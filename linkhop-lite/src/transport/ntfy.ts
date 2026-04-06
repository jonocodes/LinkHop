import type { AnyProtocolEvent } from "../protocol/types.js";

const DEFAULT_BASE_URL = "http://localhost:8080";

export function getNtfyBaseUrl(): string {
  return process.env["NTFY_URL"] ?? DEFAULT_BASE_URL;
}

export async function publish(topic: string, event: AnyProtocolEvent): Promise<void> {
  const url = `${getNtfyBaseUrl()}/${topic}`;
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(event),
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`ntfy publish failed: ${res.status} ${res.statusText}`);
  }
}

export interface SubscriptionCallbacks {
  onEvent: (raw: unknown) => void;
  onError?: (error: Error) => void;
}

export function subscribe(topic: string, callbacks: SubscriptionCallbacks): AbortController {
  const controller = new AbortController();
  const url = `${getNtfyBaseUrl()}/${topic}/json?poll=0`;

  (async () => {
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/x-ndjson" },
      });

      if (!res.ok || !res.body) {
        callbacks.onError?.(new Error(`ntfy subscribe failed: ${res.status}`));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ntfyMsg = JSON.parse(line) as Record<string, unknown>;
            // ntfy wraps messages; the actual event is in the message field
            if (ntfyMsg.event === "message" && typeof ntfyMsg.message === "string") {
              try {
                const event = JSON.parse(ntfyMsg.message);
                callbacks.onEvent(event);
              } catch {
                // Message is not JSON — might be a plain ntfy message, skip
              }
            }
          } catch {
            // Not JSON at all, skip
          }
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return controller;
}
