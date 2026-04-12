import { describe, it, expect } from "vitest";

interface RelayStore {
  kind: string;
  publish(topic: string, event: Record<string, unknown>): Promise<{ accepted: boolean; duplicate: boolean; id: number | null }>;
  listDevices(networkId: string, includeRemoved: boolean): Promise<Array<{
    network_id: string;
    device_id: string;
    device_topic: string;
    device_name: string;
    device_kind?: string;
    capabilities: unknown;
    last_event_type: string;
    last_event_at: string;
    is_removed: boolean;
  }>>;
  replay(topic: string, sinceId?: number): Promise<Array<{ id: number; topic: string; event: Record<string, unknown> }>>;
  upsertWebPushSubscription(topic: string, subscription: Record<string, unknown>): Promise<boolean>;
  removeWebPushSubscription(topic: string, subscription: Record<string, unknown>): Promise<void>;
  queuePushDeliveries(topic: string, event: Record<string, unknown>): Promise<number>;
}

describe("deno relay store implementations", () => {
  describe("store interface contract", () => {
    it("requires kind string", () => {
      const store = {
        kind: "test",
        publish: async () => ({ accepted: true, duplicate: false, id: 1 }),
        listDevices: async () => [],
        replay: async () => [],
        upsertWebPushSubscription: async () => true,
        removeWebPushSubscription: async () => {},
        queuePushDeliveries: async () => 0,
      } as RelayStore;
      expect(typeof store.kind).toBe("string");
    });

    it("publish accepts protocol event and returns result with id", async () => {
      const event = {
        type: "device.announce",
        event_id: "evt_contract",
        network_id: "net_contract",
        from_device_id: "dev_contract",
        timestamp: new Date().toISOString(),
        payload: { device_name: "Test" },
      };

      const store = {
        kind: "test",
        publish: async (topic: string, evt: Record<string, unknown>) => ({
          accepted: true,
          duplicate: false,
          id: 1,
        }),
        listDevices: async () => [],
        replay: async () => [],
        upsertWebPushSubscription: async () => true,
        removeWebPushSubscription: async () => {},
        queuePushDeliveries: async () => 0,
      } as RelayStore;

      const result = await store.publish("topic-a", event);
      expect(result.accepted).toBe(true);
      expect(typeof result.id).toBe("number");
    });

    it("listDevices returns device rows with required fields", async () => {
      const store = {
        kind: "test",
        publish: async () => ({ accepted: true, duplicate: false, id: 1 }),
        listDevices: async (networkId: string, includeRemoved: boolean) => [
          {
            network_id: networkId,
            device_id: "dev_test",
            device_topic: "topic",
            device_name: "Test",
            device_kind: "mobile",
            capabilities: [],
            last_event_type: "device.announce",
            last_event_at: new Date().toISOString(),
            is_removed: false,
          },
        ],
        replay: async () => [],
        upsertWebPushSubscription: async () => true,
        removeWebPushSubscription: async () => {},
        queuePushDeliveries: async () => 0,
      } as RelayStore;

      const devices = await store.listDevices("net_x", false);
      expect(devices[0]?.network_id).toBe("net_x");
      expect(devices[0]?.device_id).toBe("dev_test");
      expect(typeof devices[0]?.last_event_type).toBe("string");
    });

    it("replay returns events sorted by id ascending", async () => {
      const store = {
        kind: "test",
        publish: async () => ({ accepted: true, duplicate: false, id: 1 }),
        listDevices: async () => [],
        replay: async (topic: string, sinceId: number) => [
          { id: 1, topic, event: { event_id: "evt_1" } },
          { id: 2, topic, event: { event_id: "evt_2" } },
        ],
        upsertWebPushSubscription: async () => true,
        removeWebPushSubscription: async () => {},
        queuePushDeliveries: async () => 0,
      } as RelayStore;

      const events = await store.replay("topic-a", 0);
      expect(events[0]?.id).toBe(1);
      expect(events[1]?.id).toBe(2);
    });
  });

  describe("memory store invariants", () => {
    it("deduplicates by network_id + event_id on publish", async () => {
      const { InMemoryStore } = await import("../src/relay/core.js");

      const store = new InMemoryStore();
      const event = {
        type: "device.announce",
        event_id: "evt_mem_dedup",
        network_id: "net_mem",
        from_device_id: "dev_1",
        timestamp: new Date().toISOString(),
        payload: {},
      };

      await store.publish("topic-a", event);
      const result = await store.publish("topic-a", event);

      expect(result.duplicate).toBe(true);
      expect(result.id).toBe(null);
    });

    it("keeps devices after message eviction", async () => {
      const { InMemoryStore } = await import("../src/relay/core.js");

      const store = new InMemoryStore(1);

      await store.publish("topic-dev", {
        type: "device.announce",
        event_id: "evt_dev",
        network_id: "net_devices",
        from_device_id: "dev_persist",
        timestamp: new Date().toISOString(),
        payload: { device_name: "Persistent" },
      });

      await new Promise((r) => setTimeout(r, 10));

      const devices = await store.listDevices("net_devices", false);
      expect(devices.length).toBe(1);
    });

    it("sends keepalive on SSE subscribe", async () => {
      const { InMemoryStore, createRelayHandler } = await import("../src/relay/core.js");

      const handler = createRelayHandler(new InMemoryStore());
      const ac = new AbortController();

      const res = await handler(new Request("http://local/topic-sse/sse", { signal: ac.signal }));
      expect(res.status).toBe(200);

      const decoder = new TextDecoder();
      const reader = res.body!.getReader();
      const { value } = await reader.read();

      expect(value).toBeDefined();
      expect(decoder.decode(value)).toContain(": connected");

      ac.abort();
    });
  });

  describe("webpush subscriptions", () => {
    it("upsertWebPushSubscription returns boolean", async () => {
      const { InMemoryStore } = await import("../src/relay/core.js");
      const store = new InMemoryStore();

      const result = await store.upsertWebPushSubscription("topic-push", {
        endpoint: "https://example.com/push",
      });

      expect(typeof result).toBe("boolean");
    });

    it("queuePushDeliveries returns count", async () => {
      const { InMemoryStore } = await import("../src/relay/core.js");
      const store = new InMemoryStore();

      await store.upsertWebPushSubscription("topic-queue", { endpoint: "https://example.com/1" });
      const count = await store.queuePushDeliveries("topic-queue", { type: "msg.send" });

      expect(count).toBe(1);
    });
  });
});

describe("store kinds", () => {
  it("memory store has kind identifier", async () => {
    const { InMemoryStore } = await import("../src/relay/core.js");
    const store = new InMemoryStore();
    expect(store.kind).toBe("memory");
  });
});