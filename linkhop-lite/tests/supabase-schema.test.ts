import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(import.meta.dirname!, "../supabase/migrations/20260410_linkhop_relay.sql");
const migrationSql = readFileSync(migrationPath, "utf-8");

describe("supabase migration contract", () => {
  it("defines durable device and event tables", () => {
    expect(migrationSql).toContain("create table if not exists linkhop.linkhop_events");
    expect(migrationSql).toContain("create table if not exists linkhop.linkhop_devices");
  });

  it("defines webpush subscriptions table", () => {
    expect(migrationSql).toContain("create table if not exists linkhop.linkhop_webpush_subscriptions");
    expect(migrationSql).toContain("primary key (topic, endpoint)");
  });

  it("defines webpush delivery queue table", () => {
    expect(migrationSql).toContain("create table if not exists linkhop.linkhop_webpush_delivery_queue");
    expect(migrationSql).toContain("status text not null default 'queued'");
  });

  it("defines device upsert and retention functions", () => {
    expect(migrationSql).toContain("create or replace function linkhop.upsert_linkhop_device_from_event");
    expect(migrationSql).toContain("create or replace function linkhop.evict_linkhop_message_events");
    expect(migrationSql).toContain("where event_type like 'msg.%'");
  });

  it("includes optional pg_cron scheduling for eviction", () => {
    expect(migrationSql).toContain("create extension if not exists pg_cron");
    expect(migrationSql).toContain("linkhop-evict-message-events-72h");
  });
});
