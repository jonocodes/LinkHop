import { describe, it, expect } from "vitest";

describe("cloudflare worker exports", () => {
  it("exports default handler", async () => {
    const worker = await import("../workers/relay/index.js");
    expect(typeof worker.default).toBe("object");
    expect(typeof worker.default.fetch).toBe("function");
  });

  it("exports TopicSSE Durable Object class", async () => {
    const worker = await import("../workers/relay/index.js");
    expect(typeof worker.TopicSSE).toBe("function");
  });
});

describe("cloudflare wrangler config", () => {
  it("has valid wrangler.toml", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const config = readFileSync(resolve(process.cwd(), "workers/relay/wrangler.toml"), "utf-8");
    expect(config).toContain('name = "linkhop-relay"');
    expect(config).toContain("d1_databases");
    expect(config).toContain("durable_objects.bindings");
  });

  it("has migrations dir", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync("workers/relay/migrations")).toBe(true);
  });

  it("has initial schema sql", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const sql = readFileSync(resolve(process.cwd(), "workers/relay/migrations/001_initial_schema.sql"), "utf-8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS linkhop_events");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS linkhop_devices");
    expect(sql).toContain("UNIQUE(network_id, event_id)");
  });
});

describe("cloudflare cron triggers", () => {
  it("configures eviction cron", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const config = readFileSync(resolve(process.cwd(), "workers/relay/wrangler.toml"), "utf-8");
    expect(config).toContain("crons");
  });
});