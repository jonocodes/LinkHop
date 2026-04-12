/*
 * LinkHop relay entrypoint for Supabase Edge Functions.
 * Supports: memory, supabase, sqlite, postgres
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createRelayHandler,
  type DeviceRow,
  type PublishResult,
  type RelayEventRow,
  type RelayStore,
  type Json,
  InMemoryStore,
} from "../../../src/relay/core.ts";

class SqliteStore implements RelayStore {
  kind = "sqlite";
  private path: string;
  private db: SqliteDb | null = null;

  constructor(path: string) {
    this.path = path;
  }

  private getDb(): SqliteDb {
    if (this.db) return this.db;
    if (typeof (Deno as unknown as { openSqlite?: unknown }).openSqlite !== "function") {
      throw new Error("SQLite not available. Use --unstable-sqlite flag with Deno 2.5+");
    }
    this.db = (Deno as { openSqlite: (path: string) => SqliteDb }).openSqlite(this.path);
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS linkhop_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        from_device_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_ts TEXT NOT NULL,
        envelope TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(network_id, event_id)
      );
      CREATE TABLE IF NOT EXISTS linkhop_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_topic TEXT NOT NULL,
        device_name TEXT NOT NULL,
        device_kind TEXT,
        capabilities TEXT DEFAULT '[]',
        last_event_type TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        is_removed INTEGER DEFAULT 0,
        UNIQUE(network_id, device_id)
      );
      CREATE TABLE IF NOT EXISTS linkhop_webpush_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        subscription TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(topic, endpoint)
      );
      CREATE TABLE IF NOT EXISTS linkhop_webpush_delivery_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT DEFAULT 'queued',
        created_at TEXT DEFAULT (datetime('now')),
        delivered_at TEXT,
        error TEXT
      );
    `);
    return this.db;
  }

  async publish(topic: string, event: Record<string, unknown>): Promise<PublishResult> {
    const db = this.getDb();
    const networkId = String(event.network_id);
    const eventId = String(event.event_id);
    const fromDeviceId = String(event.from_device_id);
    const eventType = String(event.type);
    const eventTs = String(event.timestamp);
    const envelope = JSON.stringify(event);

    try {
      db.execute(`
        INSERT INTO linkhop_events (network_id, event_id, topic, from_device_id, event_type, event_ts, envelope)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(network_id, event_id) DO UPDATE SET
          from_device_id = excluded.from_device_id,
          event_type = excluded.event_type,
          event_ts = excluded.event_ts,
          envelope = excluded.envelope,
          created_at = datetime('now')
      `, [networkId, eventId, topic, fromDeviceId, eventType, eventTs, envelope]);
      return { accepted: true, duplicate: true, id: null };
    } catch {
      const res = db.query("SELECT id FROM linkhop_events WHERE network_id = ? AND event_id = ?", [networkId, eventId]);
      const id = res[0]?.[0] as number | undefined;
      if (id) return { accepted: true, duplicate: false, id };

      db.execute(`
        INSERT INTO linkhop_events (network_id, event_id, topic, from_device_id, event_type, event_ts, envelope)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [networkId, eventId, topic, fromDeviceId, eventType, eventTs, envelope]);

      if (eventType === "device.announce" || eventType === "device.rename" || eventType === "device.heartbeat" || eventType === "device.remove") {
        const payload = (event.payload && typeof event.payload === "object") ? event.payload as Record<string, unknown> : {};
        const now = new Date().toISOString();
        const deviceTopic = String(payload.device_topic ?? topic);
        const deviceName = String(payload.device_name ?? fromDeviceId);
        const deviceKind = payload.device_kind as string | undefined ?? null;
        const capabilities = JSON.stringify(payload.capabilities ?? []);
        const isRemoved = eventType === "device.remove" ? 1 : 0;

        try {
          db.execute(`
            INSERT INTO linkhop_devices (network_id, device_id, device_topic, device_name, device_kind, capabilities, last_event_type, last_event_at, is_removed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(network_id, device_id) DO UPDATE SET
              device_topic = excluded.device_topic,
              device_name = excluded.device_name,
              device_kind = excluded.device_kind,
              capabilities = excluded.capabilities,
              last_event_type = excluded.last_event_type,
              last_event_at = excluded.last_event_at,
              is_removed = excluded.is_removed
          `, [networkId, fromDeviceId, deviceTopic, deviceName, deviceKind, capabilities, eventType, now, isRemoved]);
        } catch {}
      }

      const newRes = db.query("SELECT id FROM linkhop_events WHERE network_id = ? AND event_id = ?", [networkId, eventId]);
      return { accepted: true, duplicate: false, id: newRes[0]?.[0] as number | null };
    }
  }

  async listDevices(networkId: string, includeRemoved: boolean): Promise<DeviceRow[]> {
    const db = this.getDb();
    const res = includeRemoved
      ? db.query("SELECT * FROM linkhop_devices WHERE network_id = ? ORDER BY last_event_at DESC", [networkId])
      : db.query("SELECT * FROM linkhop_devices WHERE network_id = ? AND is_removed = 0 ORDER BY last_event_at DESC", [networkId]);
    return res.map((row) => ({
      network_id: String(row[0]),
      device_id: String(row[1]),
      device_topic: String(row[2]),
      device_name: String(row[3]),
      device_kind: row[4] as string | undefined,
      capabilities: JSON.parse(String(row[5])),
      last_event_type: String(row[6]),
      last_event_at: String(row[7]),
      is_removed: Boolean(row[8]),
    }));
  }

  async replay(topic: string, sinceId = 0): Promise<RelayEventRow[]> {
    const db = this.getDb();
    const res = db.query(
      "SELECT id, topic, envelope FROM linkhop_events WHERE topic = ? AND id > ? ORDER BY id ASC LIMIT 500",
      [topic, sinceId],
    );
    return res.map((row) => ({
      id: Number(row[0]),
      topic: String(row[1]),
      event: JSON.parse(String(row[2])),
    }));
  }

  async upsertWebPushSubscription(topic: string, subscription: Json): Promise<boolean> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return false;
    const db = this.getDb();
    const payload = JSON.stringify(subscription);
    const now = new Date().toISOString();
    try {
      db.execute(`
        INSERT INTO linkhop_webpush_subscriptions (topic, endpoint, subscription, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(topic, endpoint) DO UPDATE SET subscription = excluded.subscription, updated_at = excluded.updated_at
      `, [topic, endpoint, payload, now]);
    } catch {}
    return true;
  }

  async removeWebPushSubscription(topic: string, subscription: Json): Promise<void> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return;
    const db = this.getDb();
    db.execute("DELETE FROM linkhop_webpush_subscriptions WHERE topic = ? AND endpoint = ?", [topic, endpoint]);
  }

  async queuePushDeliveries(topic: string, event: Record<string, unknown>): Promise<number> {
    const db = this.getDb();
    const rows = db.query("SELECT endpoint FROM linkhop_webpush_subscriptions WHERE topic = ?", [topic]);
    if (rows.length === 0) return 0;
    const now = new Date().toISOString();
    for (const row of rows) {
      db.execute(`
        INSERT INTO linkhop_webpush_delivery_queue (topic, endpoint, payload, status, created_at)
        VALUES (?, ?, ?, 'queued', ?)
      `, [topic, row[0], JSON.stringify(event), now]);
    }
    return rows.length;
  }
}

class PostgresStore implements RelayStore {
  kind = "postgres";
  private pool: unknown;

  constructor(connectionString: string) {
    this.pool = { connectionString };
  }

  private getPool() {
    return this.pool as { query: (sql: string, args: unknown[]) => unknown };
  }

  async publish(topic: string, event: Record<string, unknown>): Promise<PublishResult> {
    const pool = this.getPool();
    const networkId = String(event.network_id);
    const eventId = String(event.event_id);
    const fromDeviceId = String(event.from_device_id);
    const eventType = String(event.type);
    const eventTs = String(event.timestamp);
    const envelope = JSON.stringify(event);
    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO linkhop_events (network_id, event_id, topic, from_device_id, event_type, event_ts, envelope, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (network_id, event_id) DO UPDATE SET
        from_device_id = EXCLUDED.from_device_id,
        event_type = EXCLUDED.event_type,
        event_ts = EXCLUDED.event_ts,
        envelope = EXCLUDED.envelope,
        created_at = EXCLUDED.created_at
    `, [networkId, eventId, topic, fromDeviceId, eventType, eventTs, envelope, now]);

    if (eventType === "device.announce" || eventType === "device.rename" || eventType === "device.heartbeat" || eventType === "device.remove") {
      const payload = (event.payload && typeof event.payload === "object") ? event.payload as Record<string, unknown> : {};
      const deviceTopic = String(payload.device_topic ?? topic);
      const deviceName = String(payload.device_name ?? fromDeviceId);
      const deviceKind = payload.device_kind as string | undefined ?? null;
      const capabilities = JSON.stringify(payload.capabilities ?? []);
      const isRemoved = eventType === "device.remove";

      await pool.query(`
        INSERT INTO linkhop_devices (network_id, device_id, device_topic, device_name, device_kind, capabilities, last_event_type, last_event_at, is_removed)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (network_id, device_id) DO UPDATE SET
          device_topic = EXCLUDED.device_topic,
          device_name = EXCLUDED.device_name,
          device_kind = EXCLUDED.device_kind,
          capabilities = EXCLUDED.capabilities,
          last_event_type = EXCLUDED.last_event_type,
          last_event_at = EXCLUDED.last_event_at,
          is_removed = EXCLUDED.is_removed
      `, [networkId, fromDeviceId, deviceTopic, deviceName, deviceKind, capabilities, eventType, now, isRemoved]);
    }

    const res = await pool.query("SELECT id FROM linkhop_events WHERE network_id = $1 AND event_id = $2", [networkId, eventId]);
    const rows = res as unknown as { rows: { id: number }[] };
    return { accepted: true, duplicate: false, id: rows.rows[0]?.id ?? null };
  }

  async listDevices(networkId: string, includeRemoved: boolean): Promise<DeviceRow[]> {
    const pool = this.getPool();
    const res = includeRemoved
      ? await pool.query("SELECT * FROM linkhop_devices WHERE network_id = $1 ORDER BY last_event_at DESC", [networkId])
      : await pool.query("SELECT * FROM linkhop_devices WHERE network_id = $1 AND is_removed = false ORDER BY last_event_at DESC", [networkId]);
    return (res as unknown as { rows: DeviceRow[] }).rows;
  }

  async replay(topic: string, sinceId = 0): Promise<RelayEventRow[]> {
    const pool = this.getPool();
    const res = await pool.query(
      "SELECT id, topic, envelope FROM linkhop_events WHERE topic = $1 AND id > $2 ORDER BY id ASC LIMIT 500",
      [topic, sinceId],
    );
    const rows = res as unknown as { rows: { id: number; topic: string; envelope: string }[] };
    return rows.rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      event: JSON.parse(row.envelope),
    }));
  }

  async upsertWebPushSubscription(topic: string, subscription: Json): Promise<boolean> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return false;
    const pool = this.getPool();
    const payload = JSON.stringify(subscription);
    const now = new Date().toISOString();
    await pool.query(`
      INSERT INTO linkhop_webpush_subscriptions (topic, endpoint, subscription, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (topic, endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, updated_at = EXCLUDED.updated_at
    `, [topic, endpoint, payload, now]);
    return true;
  }

  async removeWebPushSubscription(topic: string, subscription: Json): Promise<void> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return;
    const pool = this.getPool();
    await pool.query("DELETE FROM linkhop_webpush_subscriptions WHERE topic = $1 AND endpoint = $2", [topic, endpoint]);
  }

  async queuePushDeliveries(topic: string, event: Record<string, unknown>): Promise<number> {
    const pool = this.getPool();
    const res = await pool.query("SELECT endpoint FROM linkhop_webpush_subscriptions WHERE topic = $1", [topic]);
    const rows = res as unknown as { rows: { endpoint: string }[] };
    if (rows.rows.length === 0) return 0;
    const now = new Date().toISOString();
    for (const row of rows.rows) {
      await pool.query(`
        INSERT INTO linkhop_webpush_delivery_queue (topic, endpoint, payload, status, created_at)
        VALUES ($1, $2, $3, 'queued', $4)
      `, [topic, row.endpoint, JSON.stringify(event), now]);
    }
    return rows.rows.length;
  }
}

type SqliteDb = { execute: (sql: string, args?: unknown[]) => void; query: (sql: string, args?: unknown[]) => unknown[][] };

class SupabaseStore implements RelayStore {
  kind = "supabase";

  private admin = createClient(this.url, this.serviceRoleKey, {
    auth: { persistSession: false },
  });

  constructor(
    private url: string,
    private serviceRoleKey: string,
    private vapidPublicKey: string | null,
  ) {}

  async publish(topic: string, event: Record<string, unknown>): Promise<PublishResult> {
    const row = {
      network_id: event.network_id,
      topic,
      event_id: event.event_id,
      from_device_id: event.from_device_id,
      event_type: event.type,
      event_ts: event.timestamp,
      envelope: event,
    };

    const { data, error } = await this.admin
      .schema("linkhop")
      .from("linkhop_events")
      .insert(row)
      .select("id")
      .single();

    if (error && (error as { code?: string }).code === "23505") {
      return { accepted: true, duplicate: true, id: null };
    }
    if (error) throw new Error(error.message);

    const rpc = await this.admin.rpc("upsert_linkhop_device_from_event", {
      e: event,
    });
    if (rpc.error) throw new Error(rpc.error.message);

    return { accepted: true, duplicate: false, id: data?.id ?? null };
  }

  async listDevices(networkId: string, includeRemoved: boolean): Promise<DeviceRow[]> {
    let query = this.admin
      .schema("linkhop")
      .from("linkhop_devices")
      .select("network_id,device_id,device_topic,device_name,device_kind,capabilities,last_event_type,last_event_at,is_removed")
      .eq("network_id", networkId)
      .order("last_event_at", { ascending: false });

    if (!includeRemoved) query = query.eq("is_removed", false);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data ?? []) as DeviceRow[];
  }

  async replay(topic: string, sinceId = 0): Promise<RelayEventRow[]> {
    const query = this.admin
      .schema("linkhop")
      .from("linkhop_events")
      .select("id,topic,envelope")
      .eq("topic", topic)
      .gt("id", sinceId)
      .order("id", { ascending: true })
      .limit(500);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: Number(row.id),
      topic: String(row.topic),
      event: row.envelope as Record<string, unknown>,
    }));
  }

  async upsertWebPushSubscription(topic: string, subscription: Json): Promise<boolean> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return false;

    const payload = {
      topic,
      endpoint,
      subscription,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.admin
      .schema("linkhop")
      .from("linkhop_webpush_subscriptions")
      .upsert(payload, { onConflict: "topic,endpoint" });

    if (error) throw new Error(error.message);
    return true;
  }

  async removeWebPushSubscription(topic: string, subscription: Json): Promise<void> {
    const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
    if (!endpoint) return;

    const { error } = await this.admin
      .schema("linkhop")
      .from("linkhop_webpush_subscriptions")
      .delete()
      .eq("topic", topic)
      .eq("endpoint", endpoint);

    if (error) throw new Error(error.message);
  }



  async queuePushDeliveries(topic: string, event: Record<string, unknown>): Promise<number> {
    const { data, error } = await this.admin
      .schema("linkhop")
      .from("linkhop_webpush_subscriptions")
      .select("endpoint")
      .eq("topic", topic);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    if (rows.length === 0) return 0;

    const payloads = rows.map((r) => ({
      topic,
      endpoint: String(r.endpoint),
      payload: event,
      status: "queued",
      created_at: new Date().toISOString(),
    }));

    const ins = await this.admin
      .schema("linkhop")
      .from("linkhop_webpush_delivery_queue")
      .insert(payloads);

    if (ins.error) throw new Error(ins.error.message);
    return rows.length;
  }


  async getVapidPublicKey(): Promise<string | null> {
    return this.vapidPublicKey;
  }
}

function buildStore(): RelayStore {
  const forced = Deno.env.get("RELAY_STORE")?.toLowerCase();
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("RELAY_VAPID_PUBLIC_KEY") ?? null;

  if (forced === "memory") return new InMemoryStore(72 * 60 * 60 * 1000, vapidPublicKey);

  if (forced === "sqlite") {
    const path = Deno.env.get("SQLITE_PATH") ?? "./linkhop.db";
    return new SqliteStore(path);
  }

  if (forced === "postgres" || forced === "postgresql") {
    const conn = Deno.env.get("POSTGRES_URL");
    if (!conn) throw new Error("RELAY_STORE=postgres requires POSTGRES_URL");
    return new PostgresStore(conn);
  }

  if (forced === "supabase") {
    if (!url || !key) throw new Error("RELAY_STORE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return new SupabaseStore(url, key, vapidPublicKey);
  }

  if (url && key) return new SupabaseStore(url, key, vapidPublicKey);
  return new InMemoryStore(72 * 60 * 60 * 1000, vapidPublicKey);
}

const store = buildStore();
const handler = createRelayHandler(store);

Deno.serve(handler);
