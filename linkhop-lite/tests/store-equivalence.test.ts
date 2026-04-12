import { describe, it, expect } from "vitest";
import { InMemoryStore, createRelayHandler, type RelayStore } from "../src/relay/core.js";

function makeEvent(overrides = {}) {
  return {
    type: "device.announce",
    event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    network_id: "net_eq",
    from_device_id: "dev_eq",
    timestamp: new Date().toISOString(),
    payload: { device_name: "Equiv Test" },
    ...overrides,
  };
}

function makeMsg(overrides = {}) {
  return {
    type: "msg.send",
    event_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    network_id: "net_msg_eq",
    from_device_id: "dev_sender",
    timestamp: new Date().toISOString(),
    payload: { msg_id: "msg_1", to_device_id: "dev_receiver", body: { kind: "text", text: "hello" } },
    ...overrides,
  };
}

async function withHandler<T>(store: RelayStore, fn: (handler: (req: Request) => Promise<Response>) => Promise<T>): Promise<T> {
  const handler = createRelayHandler(store);
  return fn(handler);
}

describe("store equivalence", () => {
  describe("InMemoryStore behavior", () => {
    it("publishes and returns id", async () => {
      const store = new InMemoryStore();
      const result = await store.publish("topic-eq", makeEvent());

      expect(result.accepted).toBe(true);
      expect(typeof result.id).toBe("number");
    });

    it("deduplicates by network_id + event_id", async () => {
      const store = new InMemoryStore();
      const event = makeEvent({ event_id: "evt_eq_dedup" });

      await store.publish("topic-eq", event);
      const result = await store.publish("topic-eq", event);

      expect(result.duplicate).toBe(true);
    });

    it("updates device on device.announce", async () => {
      const store = new InMemoryStore();
      await store.publish("topic-eq", makeEvent());

      const devices = await store.listDevices("net_eq", false);
      expect(devices.length).toBe(1);
      expect(devices[0].device_name).toBe("Equiv Test");
    });

    it("marks device removed on device.remove", async () => {
      const store = new InMemoryStore();
      await store.publish("topic-eq", makeEvent({ type: "device.remove", event_id: "evt_eq_rem", payload: {} }));

      const all = await store.listDevices("net_eq", true);
      const active = await store.listDevices("net_eq", false);

      expect(all[0].is_removed).toBe(true);
      expect(active.length).toBe(0);
    });

    it("keeps devices after message eviction", async () => {
      const store = new InMemoryStore(1);
      await store.publish("topic-eq", makeEvent());
      await new Promise((r) => setTimeout(r, 10));

      const devices = await store.listDevices("net_eq", false);
      expect(devices.length).toBe(1);
    });

    it("replays events after sinceId", async () => {
      const store = new InMemoryStore();
      await store.publish("topic-replay", makeEvent({ event_id: "evt_rep_1" }));
      await store.publish("topic-replay", makeEvent({ event_id: "evt_rep_2" }));

      const events = await store.replay("topic-replay", 0);
      expect(events.length).toBe(2);

      const since1 = await store.replay("topic-replay", 1);
      expect(since1.length).toBe(1);
    });

    it("handles webpush subscriptions", async () => {
      const store = new InMemoryStore();

      const ok = await store.upsertWebPushSubscription("topic-push", { endpoint: "https://test.example/push" });
      expect(ok).toBe(true);

      await store.removeWebPushSubscription("topic-push", { endpoint: "https://test.example/push" });
    });

    it("queues push deliveries", async () => {
      const store = new InMemoryStore();
      await store.upsertWebPushSubscription("topic-queue", { endpoint: "https://test.example/1" });

      const count = await store.queuePushDeliveries("topic-queue", makeMsg());
      expect(count).toBe(1);
    });
  });

  describe("handler behavior invariant", () => {
    const stores: { name: string; store: RelayStore }[] = [
      { name: "InMemory", store: new InMemoryStore() },
    ];

    for (const { name, store } of stores) {
      describe(`for ${name} store`, () => {
        it("POST /:topic returns 202 for valid event", async () => {
          const handler = createRelayHandler(store);
          const res = await handler(new Request("http://local/topic-test", {
            method: "POST",
            body: JSON.stringify(makeEvent()),
          }));

          expect(res.status).toBe(202);
        });

        it("POST /:topic returns 200 for duplicate", async () => {
          const event = makeEvent({ event_id: "evt_dup_handler" });
          const handler = createRelayHandler(store);

          await handler(new Request("http://local/topic-dup", { method: "POST", body: JSON.stringify(event) }));
          const res = await handler(new Request("http://local/topic-dup", { method: "POST", body: JSON.stringify(event) }));

          expect(res.status).toBe(200);
        });

        it("GET /registry/:id/devices returns devices", async () => {
          const handler = createRelayHandler(store);
          const event = makeEvent({ network_id: "net_handler_dev", from_device_id: "dev_hd" });
          await handler(new Request("http://local/topic-hd", { method: "POST", body: JSON.stringify(event) }));

          const res = await handler(new Request("http://local/registry/net_handler_dev/devices"));
          const body = await res.json();

          expect(body.devices.length).toBe(1);
        });

        it("GET /:topic/sse returns event-stream", async () => {
          const handler = createRelayHandler(store);
          const res = await handler(new Request("http://local/topic-sse/sse"));

          expect(res.status).toBe(200);
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        });

        it("GET /health returns ok", async () => {
          const handler = createRelayHandler(store);
          const res = await handler(new Request("http://local/health"));
          const body = await res.json();

          expect(body.ok).toBe(true);
        });
      });
    }
  });

  describe("event type handling", () => {
    it("handles device.announce", async () => {
      const store = new InMemoryStore();
      await store.publish("topic-types", { type: "device.announce", event_id: "evt_ann", network_id: "net_ann", from_device_id: "dev_ann", timestamp: new Date().toISOString(), payload: { device_name: "A" } });

      const devs = await store.listDevices("net_ann", false);
      expect(devs[0].last_event_type).toBe("device.announce");
    });

    it("handles device.rename", async () => {
      const store = new InMemoryStore();
      await store.publish("topic-ren", { type: "device.rename", event_id: "evt_ren", network_id: "net_ren", from_device_id: "dev_ren", timestamp: new Date().toISOString(), payload: { device_name: "New Name" } });

      const devs = await store.listDevices("net_ren", false);
      expect(devs[0].device_name).toBe("New Name");
    });

    it("handles device.heartbeat", async () => {
      const store = new InMemoryStore();
      await store.publish("topic-hb", { type: "device.heartbeat", event_id: "evt_hb", network_id: "net_hb", from_device_id: "dev_hb", timestamp: new Date().toISOString(), payload: {} });

      const devs = await store.listDevices("net_hb", false);
      expect(devs[0].last_event_type).toBe("device.heartbeat");
    });

    it("handles device.remove", async () => {
      const store = new InMemoryStore();
      await store.publish("topic-rem-type", { type: "device.remove", event_id: "evt_rem_type", network_id: "net_rem_type", from_device_id: "dev_rem_type", timestamp: new Date().toISOString(), payload: {} });

      const devs = await store.listDevices("net_rem_type", false);
      expect(devs.length).toBe(0);
    });
  });

  describe("message handling", () => {
    it("queues push on msg.send when subscriptions exist", async () => {
      const store = new InMemoryStore();
      await store.upsertWebPushSubscription("topic-msg-q", { endpoint: "https://push.example/q" });

      const queued = await store.queuePushDeliveries("topic-msg-q", makeMsg());
      expect(queued).toBe(1);
    });

    it("queues on any event when topic has subscriptions", async () => {
      const store = new InMemoryStore();
      await store.upsertWebPushSubscription("topic-any-q", { endpoint: "https://push.example/any" });

      const queued = await store.queuePushDeliveries("topic-any-q", { type: "anything", payload: {} });
      expect(queued).toBe(1);
    });
  });

  describe("concurrency simulation", () => {
    it("handles rapid publishes", async () => {
      const store = new InMemoryStore();
      const events = Array.from({ length: 10 }, () => ({ type: "msg.send", event_id: `evt_rapid_${Math.random()}`, network_id: "net_rapid", from_device_id: "dev_rapid", timestamp: new Date().toISOString(), payload: {} }));

      const results = await Promise.all(events.map((e) => store.publish("topic-rapid", e)));

      expect(results.every((r) => r.accepted)).toBe(true);
    });

    it("handles concurrent device updates", async () => {
      const store = new InMemoryStore();
      const updates = Array.from({ length: 5 }, (_, i) => ({
        type: "device.announce",
        event_id: `evt_conc_${i}`,
        network_id: "net_conc",
        from_device_id: "dev_conc",
        timestamp: new Date().toISOString(),
        payload: { device_name: `Update ${i}` },
      }));

      await Promise.all(updates.map((e) => store.publish("topic-conc", e)));
      const devs = await store.listDevices("net_conc", false);

      expect(devs.length).toBe(1);
    });
  });
});