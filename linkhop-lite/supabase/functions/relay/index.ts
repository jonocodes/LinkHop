/*
 * LinkHop relay entrypoint for Supabase Edge Functions.
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
