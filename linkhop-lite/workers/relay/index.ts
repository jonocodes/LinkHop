export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const store = new CloudflareStore(env);
    return handleRelay(req, store, env);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const store = new CloudflareStore(env);
    if (event.cron === "0 * * *") {
      await evictOldMessages(store);
    }
    if (event.cron === "*/5 * * * *") {
      await processPushQueue(store);
    }
    if (event.cron === "0 */6 * * *") {
      await cleanupDeadSubscriptions(store);
    }
  },
};

export interface Env {
  DB: D1Database;
  TOPIC_SSE: DurableObjectNamespace;
  RELAY_VAPID_PUBLIC_KEY?: string;
}

function log(level: string, data: Record<string, unknown>) {
  const entry = {
    ...data,
    level,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(entry));
}

async function handleRelay(req: Request, store: CloudflareStore, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,authorization,last-event-id",
      },
    });
  }

  if (req.method === "GET" && parts.length === 1 && parts[0] === "health") {
    return json(200, { ok: true, store: store.kind });
  }

  if (req.method === "GET" && parts.length === 2 && parts[0] === "v1" && parts[1] === "webpush") {
    const key = env.RELAY_VAPID_PUBLIC_KEY ?? null;
    if (!key) return json(404, { error: "webpush not configured" });
    return json(200, { public_key: key });
  }

  if (req.method === "GET" && parts.length === 3 && parts[0] === "registry" && parts[2] === "devices") {
    const networkId = decodeURIComponent(parts[1]);
    const includeRemoved = url.searchParams.get("include_removed") === "1";
    try {
      const devices = await store.listDevices(networkId, includeRemoved);
      log("info", { network_id: networkId, status: "devices_listed", count: devices.length });
      return json(200, { network_id: networkId, devices, store: store.kind });
    } catch (err) {
      log("error", { network_id: networkId, status: "devices_list_failed", error: err instanceof Error ? err.message : "unknown" });
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
      const ok = await store.upsertWebPushSubscription(topic, body as Record<string, unknown>);
      return json(ok ? 200 : 400, ok ? { ok: true } : { error: "invalid push subscription" });
    }

    await store.removeWebPushSubscription(topic, body as Record<string, unknown>);
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
      log("info", {
        topic,
        event_type: (body as Record<string, unknown>).type,
        network_id: (body as Record<string, unknown>).network_id,
        event_id: (body as Record<string, unknown>).event_id,
        status: result.duplicate ? "duplicate" : "accepted",
        queued_push: queuedPush,
      });
      if (!result.duplicate && result.id) {
        try {
          const doId = env.TOPIC_SSE.idFromName(topic);
          const stub = env.TOPIC_SSE.get(doId);
          await stub.fetch("https://internal/broadcast", {
            method: "POST",
            body: JSON.stringify({ id: result.id, topic, event: body }),
          });
        } catch {}
      }
      return json(result.duplicate ? 200 : 202, { ...result, queued_push: queuedPush, store: store.kind });
    } catch (err) {
      log("error", { topic, status: "publish_failed", error: err instanceof Error ? err.message : "unknown" });
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
    log("info", { topic, status: "sse_connect", since_id: sinceId });
    return openSSE(store, topic, sinceId, once, env, req.signal);
  }

  return json(404, { error: "not found" });
}

function json(status: number, body: Record<string, unknown>): Response {
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

function isProtocolEvent(value: unknown): boolean {
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

function sseFrame(row: { id: number; topic: string; event: Record<string, unknown> }): string {
  const wrapped = JSON.stringify({ event: "message", message: JSON.stringify(row.event) });
  return `id: ${row.id}\nevent: message\ndata: ${wrapped}\n\n`;
}

async function openSSE(
  store: CloudflareStore,
  topic: string,
  sinceId: number,
  once: boolean,
  env: Env,
  signal?: AbortSignal,
): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      try {
        const backlog = await store.replay(topic, sinceId);
        for (const row of backlog) {
          controller.enqueue(encoder.encode(sseFrame(row)));
        }
      } catch {}

      if (once) {
        controller.close();
        return;
      }

      let closed = false;
      let doId: DurableObjectId | undefined;

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          close();
        }
      }, 15_000);

      try {
        doId = env.TOPIC_SSE.idFromName(topic);
        const stub = env.TOPIC_SSE.get(doId);
        const doReq = new Request("https://internal/subscribe");
        const doResp = await stub.fetch(doReq);
        const doBody = doResp.body;
        if (doBody) {
          const reader = doBody.getReader();
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
      } catch {}

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        controller.close();
      };

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

type Json = Record<string, unknown>;

type DeviceRow = {
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

type RelayEventRow = {
  id: number;
  topic: string;
  event: Record<string, unknown>;
};

type PublishResult = { accepted: true; duplicate: boolean; id: number | null };

interface RelayStore {
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

async function evictOldMessages(store: CloudflareStore): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { success, error } = await store.env.DB.prepare(`
    DELETE FROM linkhop_events
    WHERE event_type LIKE 'msg.%'
    AND created_at < ?
  `).bind(cutoff).run();

  if (error) throw new Error(error);
  return { deleted: success ? 1 : 0 };
}

async function processPushQueue(store: CloudflareStore): Promise<{ delivered: number; failed: number }> {
  const { results, error } = await store.env.DB.prepare(`
    SELECT id, topic, endpoint, payload
    FROM linkhop_webpush_delivery_queue
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 100
  `).all();

  if (error) throw new Error(error);

  const rows = results ?? [];
  let delivered = 0;
  let failed = 0;

  for (const row of rows) {
    const id = Number(row.id);
    const endpoint = String(row.endpoint);
    const payload = JSON.parse(String(row.payload));
    const topic = String(row.topic);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "TTL": "86400",
          "Topic": topic,
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 200 || res.status === 201) {
        await store.env.DB.prepare(`
          UPDATE linkhop_webpush_delivery_queue
          SET status = 'delivered', delivered_at = datetime('now')
          WHERE id = ?
        `).bind(id).run();
        delivered++;
      } else if (res.status === 404 || res.status === 410) {
        await store.env.DB.prepare(`
          UPDATE linkhop_webpush_delivery_queue
          SET status = 'failed', error = ?, delivered_at = datetime('now')
          WHERE id = ?
        `).bind(`http_${res.status}`, id).run();
        failed++;
      } else {
        await store.env.DB.prepare(`
          UPDATE linkhop_webpush_delivery_queue
          SET status = 'retry', error = ?
          WHERE id = ?
        `).bind(`http_${res.status}`, id).run();
      }
    } catch (err) {
      await store.env.DB.prepare(`
        UPDATE linkhop_webpush_delivery_queue
        SET status = 'retry', error = ?
        WHERE id = ?
      `).bind(err instanceof Error ? err.message : "unknown", id).run();
    }
  }

  return { delivered, failed };
}

async function cleanupDeadSubscriptions(store: CloudflareStore): Promise<{ removed: number }> {
  const { results, error } = await store.env.DB.prepare(`
    SELECT id, topic, endpoint
    FROM linkhop_webpush_subscriptions
  `).all();

  if (error) throw new Error(error);

  const rows = results ?? [];
  let removed = 0;

  for (const row of rows) {
    const endpoint = String(row.endpoint);
    try {
      const res = await fetch(endpoint, { method: "HEAD" });
      if (res.status === 404 || res.status === 410) {
        await store.env.DB.prepare(`
          DELETE FROM linkhop_webpush_subscriptions
          WHERE endpoint = ?
        `).bind(endpoint).run();
        removed++;
      }
    } catch {}
  }

  return { removed };
}

class CloudflareStore implements RelayStore {
  kind = "cloudflare";

  constructor(public env: Env) {}

  async publish(topic: string, event: Record<string, unknown>): Promise<PublishResult> {
    const networkId = String(event.network_id);
    const eventId = String(event.event_id);
    const fromDeviceId = String(event.from_device_id);
    const eventType = String(event.type);
    const eventTs = String(event.timestamp);
    const envelope = JSON.stringify(event);

    const { success, error } = await this.env.DB.prepare(`
      INSERT INTO linkhop_events (network_id, event_id, topic, from_device_id, event_type, event_ts, envelope)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(network_id, event_id) DO UPDATE SET
        from_device_id = excluded.from_device_id,
        event_type = excluded.event_type,
        event_ts = excluded.event_ts,
        envelope = excluded.envelope,
        created_at = CURRENT_TIMESTAMP
    `).bind(networkId, eventId, topic, fromDeviceId, eventType, eventTs, envelope).run();

    if (error) {
      if (error.includes("UNIQUE constraint failed")) {
        return { accepted: true, duplicate: true, id: null };
      }
      throw new Error(error);
    }

    const now = new Date().toISOString();
    let deviceTopic = topic;
    let deviceName = fromDeviceId;
    let deviceKind: string | null = null;
    let capabilities: unknown = [];
    let isRemoved = false;
    let lastEventType = eventType;

    if (eventType === "device.announce" || eventType === "device.rename" || eventType === "device.heartbeat" || eventType === "device.remove") {
      const payload = (event.payload && typeof event.payload === "object")
        ? event.payload as Record<string, unknown>
        : {};

      deviceTopic = String(payload.device_topic ?? topic);
      deviceName = String(payload.device_name ?? fromDeviceId);
      deviceKind = payload.device_kind as string | undefined ?? null;
      capabilities = payload.capabilities ?? [];
      isRemoved = eventType === "device.remove";

      await this.env.DB.prepare(`
        INSERT INTO linkhop_devices (network_id, device_id, device_topic, device_name, device_kind, capabilities, last_event_type, last_event_at, is_removed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(network_id, device_id) DO UPDATE SET
          device_topic = excluded.device_topic,
          device_name = excluded.device_name,
          device_kind = excluded.device_kind,
          capabilities = excluded.capabilities,
          last_event_type = excluded.last_event_type,
          last_event_at = excluded.last_event_at,
          is_removed = excluded.is_removed
      `).bind(networkId, fromDeviceId, deviceTopic, deviceName, deviceKind, JSON.stringify(capabilities), eventType, now, isRemoved).run();
    }

    const row = await this.env.DB.prepare("SELECT id FROM linkhop_events WHERE network_id = ? AND event_id = ?")
      .bind(networkId, eventId)
      .first<{ id: number }>();

    return { accepted: true, duplicate: false, id: row?.id ?? null };
  }

  async listDevices(networkId: string, includeRemoved: boolean): Promise<DeviceRow[]> {
    let query = this.env.DB.prepare(`
      SELECT network_id, device_id, device_topic, device_name, device_kind, capabilities, last_event_type, last_event_at, is_removed
      FROM linkhop_devices
      WHERE network_id = ?
      ORDER BY last_event_at DESC
    `).bind(networkId);

    if (!includeRemoved) {
      query = this.env.DB.prepare(`
        SELECT network_id, device_id, device_topic, device_name, device_kind, capabilities, last_event_type, last_event_at, is_removed
        FROM linkhop_devices
        WHERE network_id = ? AND is_removed = 0
        ORDER BY last_event_at DESC
      `).bind(networkId);
    }

    const { results, error } = await query.all();
    if (error) throw new Error(error);

    return (results ?? []).map((row: Record<string, unknown>) => ({
      network_id: String(row.network_id),
      device_id: String(row.device_id),
      device_topic: String(row.device_topic),
      device_name: String(row.device_name),
      device_kind: row.device_kind as string | undefined,
      capabilities: row.capabilities,
      last_event_type: String(row.last_event_type),
      last_event_at: String(row.last_event_at),
      is_removed: Boolean(row.is_removed),
    }));
  }

  async replay(topic: string, sinceId = 0): Promise<RelayEventRow[]> {
    const { results, error } = await this.env.DB.prepare(`
      SELECT id, topic, envelope
      FROM linkhop_events
      WHERE topic = ? AND id > ?
      ORDER BY id ASC
      LIMIT 500
    `).bind(topic, sinceId).all();

    if (error) throw new Error(error);

    return (results ?? []).map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      topic: String(row.topic),
      event: JSON.parse(String(row.envelope)) as Record<string, unknown>,
    }));
  }

  async upsertWebPushSubscription(topic: string, subscription: Json): Promise<boolean> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return false;

    const payload = JSON.stringify(subscription);
    const now = new Date().toISOString();

    const { error } = await this.env.DB.prepare(`
      INSERT INTO linkhop_webpush_subscriptions (topic, endpoint, subscription, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(topic, endpoint) DO UPDATE SET
        subscription = excluded.subscription,
        updated_at = excluded.updated_at
    `).bind(topic, endpoint, payload, now).run();

    if (error) throw new Error(error);
    return true;
  }

  async removeWebPushSubscription(topic: string, subscription: Json): Promise<void> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return;

    const { error } = await this.env.DB.prepare(`
      DELETE FROM linkhop_webpush_subscriptions
      WHERE topic = ? AND endpoint = ?
    `).bind(topic, endpoint).run();

    if (error) throw new Error(error);
  }

  async queuePushDeliveries(topic: string, event: Record<string, unknown>): Promise<number> {
    const { results, error } = await this.env.DB.prepare(`
      SELECT endpoint FROM linkhop_webpush_subscriptions WHERE topic = ?
    `).bind(topic).all();

    if (error) throw new Error(error);

    const rows = results ?? [];
    if (rows.length === 0) return 0;

    const now = new Date().toISOString();
    const payloads = rows.map((row: Record<string, unknown>) => ({
      topic,
      endpoint: String(row.endpoint),
      payload: JSON.stringify(event),
      status: "queued",
      created_at: now,
    }));

    for (const p of payloads) {
      await this.env.DB.prepare(`
        INSERT INTO linkhop_webpush_delivery_queue (topic, endpoint, payload, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(p.topic, p.endpoint, p.payload, p.status, p.created_at).run();
    }

    return rows.length;
  }
}

export class TopicSSE implements DurableObject {
  private clients: Set<DurableObjectRemoteStream<Uint8Array>> = new Set();
  private heartbeatTimer: number | null = null;

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    if (req.method === "GET") {
      return this.handleSSE();
    }
    if (req.method === "POST") {
      return this.handleBroadcast(req);
    }
    return new Response("method not allowed", { status: 405 });
  }

  private async handleSSE(): Promise<Response> {
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode(": connected\n\n"));

        this.heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            this.removeClient(controller);
          }
        }, 15_000);

        this.clients.add(controller as unknown as DurableObjectRemoteStream<Uint8Array>);
      },
      cancel: () => {
        closed = true;
        this.clearHeartbeat();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "access-control-allow-origin": "*",
      },
    });
  }

  private async handleBroadcast(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid JSON body" });
    }

    const row = body as { id: number; topic: string; event: Record<string, unknown> };
    if (typeof row.id !== "number" || !row.event) {
      return json(400, { error: "invalid broadcast payload" });
    }

    const frame = sseFrame(row);
    for (const client of this.clients) {
      try {
        client.enqueue(new TextEncoder().encode(frame));
      } catch {
        this.clients.delete(client);
      }
    }

    return json(200, { delivered: this.clients.size });
  }

  private removeClient(controller: ReadableStreamDefaultController<Uint8Array>) {
    this.clients.delete(controller as unknown as DurableObjectRemoteStream<Uint8Array>);
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async close() {
    this.clearHeartbeat();
    this.clients.clear();
  }
}