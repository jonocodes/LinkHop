export type Json = Record<string, unknown>;

export type DeviceRow = {
  network_id: string;
  device_id: string;
  device_topic: string;
  device_name: string;
  device_kind?: string;
  capabilities: unknown;
  last_event_type: string;
  last_event_at: string;
  is_removed: boolean;
};

export type RelayEventRow = {
  id: number;
  topic: string;
  event: Record<string, unknown>;
};

export type PublishResult = { accepted: true; duplicate: boolean; id: number | null };

export interface RelayStore {
  kind: string;
  publish(topic: string, event: Record<string, unknown>): Promise<PublishResult>;
  listDevices(networkId: string, includeRemoved: boolean): Promise<DeviceRow[]>;
  replay(topic: string, sinceId?: number): Promise<RelayEventRow[]>;
  subscribe?(topic: string, listener: (row: RelayEventRow) => void): () => void;
  upsertWebPushSubscription(topic: string, subscription: Json): Promise<boolean>;
  removeWebPushSubscription(topic: string, subscription: Json): Promise<void>;
  getVapidPublicKey?(): Promise<string | null>;
  queuePushDeliveries(topic: string, event: Record<string, unknown>): Promise<number>;
}

function eventMs(event: Record<string, unknown>): number {
  const raw = event.timestamp;
  if (typeof raw !== "string") return Date.now();
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? Date.now() : ms;
}

function updateDeviceFromEvent(prev: DeviceRow | undefined, event: Record<string, unknown>, topic: string): DeviceRow | null {
  const type = event.type;
  if (
    type !== "device.announce" &&
    type !== "device.rename" &&
    type !== "device.heartbeat" &&
    type !== "device.remove"
  ) {
    return null;
  }

  const payload = (event.payload && typeof event.payload === "object")
    ? event.payload as Record<string, unknown>
    : {};

  const deviceId = String(event.from_device_id);
  const networkId = String(event.network_id);
  const ts = new Date(eventMs(event)).toISOString();

  return {
    network_id: networkId,
    device_id: deviceId,
    device_topic: String(payload.device_topic ?? prev?.device_topic ?? topic),
    device_name: String(payload.device_name ?? prev?.device_name ?? deviceId),
    device_kind: (payload.device_kind ?? prev?.device_kind) as string | undefined,
    capabilities: payload.capabilities ?? prev?.capabilities ?? [],
    last_event_type: String(type),
    last_event_at: ts,
    is_removed: type === "device.remove" ? true : (type === "device.announce" ? false : (prev?.is_removed ?? false)),
  };
}

export class InMemoryStore implements RelayStore {
  kind = "memory";
  private nextId = 1;
  private events: Array<{ id: number; topic: string; event: Record<string, unknown>; createdAtMs: number }> = [];
  private devices = new Map<string, DeviceRow>();
  private seenEventKeys = new Set<string>();
  private subscribers = new Map<string, Set<(row: RelayEventRow) => void>>();
  private webpushByTopic = new Map<string, Map<string, Json>>();
  private pushQueue: Array<{ topic: string; event: Record<string, unknown>; endpoint: string; queuedAt: string }> = [];

  constructor(
    private retentionMs = 72 * 60 * 60 * 1000,
    private vapidPublicKey: string | null = null,
  ) {}

  private makeDedupKey(event: Record<string, unknown>): string {
    return `${String(event.network_id)}:${String(event.event_id)}`;
  }

  private pruneMessages(now = Date.now()): void {
    const cutoff = now - this.retentionMs;
    this.events = this.events.filter((row) => {
      const type = row.event.type;
      if (typeof type !== "string") return true;
      if (!type.startsWith("msg.")) return true;
      return row.createdAtMs >= cutoff;
    });
  }

  async publish(topic: string, event: Record<string, unknown>): Promise<PublishResult> {
    this.pruneMessages();

    const key = this.makeDedupKey(event);
    if (this.seenEventKeys.has(key)) {
      return { accepted: true, duplicate: true, id: null };
    }

    this.seenEventKeys.add(key);
    const id = this.nextId++;
    const row = { id, topic, event, createdAtMs: Date.now() };
    this.events.push(row);

    const dKey = `${String(event.network_id)}:${String(event.from_device_id)}`;
    const next = updateDeviceFromEvent(this.devices.get(dKey), event, topic);
    if (next) this.devices.set(dKey, next);

    const listeners = this.subscribers.get(topic);
    if (listeners) {
      const payload: RelayEventRow = { id, topic, event };
      for (const listener of listeners) listener(payload);
    }

    return { accepted: true, duplicate: false, id };
  }

  async listDevices(networkId: string, includeRemoved: boolean): Promise<DeviceRow[]> {
    this.pruneMessages();

    return [...this.devices.values()]
      .filter((d) => d.network_id === networkId)
      .filter((d) => includeRemoved ? true : !d.is_removed)
      .sort((a, b) => b.last_event_at.localeCompare(a.last_event_at));
  }

  async replay(topic: string, sinceId = 0): Promise<RelayEventRow[]> {
    this.pruneMessages();
    return this.events
      .filter((row) => row.topic === topic && row.id > sinceId)
      .sort((a, b) => a.id - b.id)
      .map((row) => ({ id: row.id, topic: row.topic, event: row.event }));
  }

  subscribe(topic: string, listener: (row: RelayEventRow) => void): () => void {
    if (!this.subscribers.has(topic)) this.subscribers.set(topic, new Set());
    this.subscribers.get(topic)!.add(listener);
    return () => {
      this.subscribers.get(topic)?.delete(listener);
    };
  }

  async upsertWebPushSubscription(topic: string, subscription: Json): Promise<boolean> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return false;
    if (!this.webpushByTopic.has(topic)) this.webpushByTopic.set(topic, new Map());
    this.webpushByTopic.get(topic)!.set(endpoint, subscription);
    return true;
  }

  async removeWebPushSubscription(topic: string, subscription: Json): Promise<void> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return;
    this.webpushByTopic.get(topic)?.delete(endpoint);
  }

  async queuePushDeliveries(topic: string, event: Record<string, unknown>): Promise<number> {
    const subs = this.webpushByTopic.get(topic);
    if (!subs || subs.size === 0) return 0;
    const queuedAt = new Date().toISOString();
    for (const endpoint of subs.keys()) {
      this.pushQueue.push({ topic, event, endpoint, queuedAt });
    }
    return subs.size;
  }

  async getVapidPublicKey(): Promise<string | null> {
    return this.vapidPublicKey;
  }
}

export function isProtocolEvent(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.type === "string" &&
    typeof e.event_id === "string" &&
    typeof e.network_id === "string" &&
    typeof e.from_device_id === "string" &&
    typeof e.timestamp === "string"
  );
}

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,last-event-id",
    },
  });
}

function parsePath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function sseFrame(row: RelayEventRow): string {
  const wrapped = JSON.stringify({ event: "message", message: JSON.stringify(row.event) });
  return `id: ${row.id}\nevent: message\ndata: ${wrapped}\n\n`;
}

function openSSE(store: RelayStore, topic: string, sinceId: number, once: boolean, signal?: AbortSignal): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      const backlog = await store.replay(topic, sinceId);
      for (const row of backlog) {
        controller.enqueue(encoder.encode(sseFrame(row)));
      }

      if (once) {
        controller.close();
        return;
      }

      let closed = false;
      let unsubscribe: (() => void) | undefined;
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          close();
        }
      }, 15_000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        controller.close();
      };

      unsubscribe = store.subscribe?.(topic, (row) => {
        try {
          controller.enqueue(encoder.encode(sseFrame(row)));
        } catch {
          close();
        }
      });

      signal?.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    },
  });
}

export function createRelayHandler(store: RelayStore) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });

    const url = new URL(req.url);
    const parts = parsePath(url.pathname);

    if (req.method === "GET" && parts.length === 1 && parts[0] === "health") {
      return json(200, { ok: true, store: store.kind });
    }

    if (req.method === "GET" && parts.length === 2 && parts[0] === "v1" && parts[1] === "webpush") {
      const key = await store.getVapidPublicKey?.();
      if (!key) return json(404, { error: "webpush not configured" });
      return json(200, { public_key: key });
    }

    if (req.method === "GET" && parts.length === 3 && parts[0] === "registry" && parts[2] === "devices") {
      const networkId = decodeURIComponent(parts[1]);
      const includeRemoved = url.searchParams.get("include_removed") === "1";
      try {
        const devices = await store.listDevices(networkId, includeRemoved);
        return json(200, { network_id: networkId, devices, store: store.kind });
      } catch (err) {
        return json(500, { error: err instanceof Error ? err.message : "failed to load devices" });
      }
    }

    if (parts.length === 2 && parts[1] === "webpush" && (req.method === "POST" || req.method === "DELETE")) {
      const topic = decodeURIComponent(parts[0]);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: "invalid JSON body" });
      }
      if (!body || typeof body !== "object") return json(400, { error: "invalid push subscription" });

      if (req.method === "POST") {
        const ok = await store.upsertWebPushSubscription(topic, body as Json);
        return json(ok ? 200 : 400, ok ? { ok: true } : { error: "invalid push subscription" });
      }

      await store.removeWebPushSubscription(topic, body as Json);
      return json(200, { ok: true });
    }

    if (req.method === "POST" && parts.length === 1) {
      const topic = decodeURIComponent(parts[0]);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: "invalid JSON body" });
      }

      if (!isProtocolEvent(body)) {
        return json(400, { error: "invalid protocol event envelope" });
      }

      try {
        const result = await store.publish(topic, body);
        let queuedPush = 0;
        if (!result.duplicate && (body as Record<string, unknown>).type === "msg.send") {
          queuedPush = await store.queuePushDeliveries(topic, body as Record<string, unknown>);
        }
        return json(result.duplicate ? 200 : 202, { ...result, queued_push: queuedPush, store: store.kind });
      } catch (err) {
        return json(500, { error: err instanceof Error ? err.message : "publish failed" });
      }
    }

    if (req.method === "GET" && parts.length === 2 && parts[1] === "sse") {
      const topic = decodeURIComponent(parts[0]);
      const sinceFromQuery = Number(url.searchParams.get("since_id") ?? "0");
      const sinceFromHeader = Number(req.headers.get("last-event-id") ?? "0");
      const sinceId = Number.isFinite(sinceFromQuery) && sinceFromQuery > 0
        ? sinceFromQuery
        : (Number.isFinite(sinceFromHeader) ? sinceFromHeader : 0);
      const once = url.searchParams.get("once") === "1";
      return openSSE(store, topic, sinceId, once, req.signal);
    }

    return json(404, { error: "not found" });
  };
}
