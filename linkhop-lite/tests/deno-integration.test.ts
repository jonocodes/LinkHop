import { describe, it, expect } from "vitest";
import { InMemoryStore, createRelayHandler } from "../src/relay/core.js";

const testStore = () => new InMemoryStore();
const testHandler = () => createRelayHandler(testStore());

describe("relay handler integration tests", () => {
  describe("POST /:topic", () => {
    it("accepts valid device.announce event", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/topic-a", {
        method: "POST",
        body: JSON.stringify({
          type: "device.announce",
          event_id: "evt_ann_1",
          network_id: "net_a",
          from_device_id: "dev_1",
          timestamp: new Date().toISOString(),
          payload: { device_name: "Device One" },
        }),
      }));

      expect(res.status).toBe(202);
      expect((await res.json()).accepted).toBe(true);
    });

    it("accepts valid msg.send event", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/topic-msg", {
        method: "POST",
        body: JSON.stringify({
          type: "msg.send",
          event_id: "evt_msg_1",
          network_id: "net_msg",
          from_device_id: "dev_sender",
          timestamp: new Date().toISOString(),
          payload: { msg_id: "msg_abc", to_device_id: "dev_receiver", body: { kind: "text", text: "hello" } },
        }),
      }));

      expect(res.status).toBe(202);
    });

    it("rejects malformed JSON", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/topic-a", {
        method: "POST",
        body: "not valid json",
      }));

      expect(res.status).toBe(400);
    });

    it("rejects invalid protocol envelope", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/topic-a", {
        method: "POST",
        body: JSON.stringify({ foo: "bar" }),
      }));

      expect(res.status).toBe(400);
    });

    it("deduplicates events", async () => {
      const handler = testHandler();
      const event = {
        type: "device.announce",
        event_id: "evt_dup",
        network_id: "net_dup",
        from_device_id: "dev_dup",
        timestamp: new Date().toISOString(),
        payload: {},
      };

      const r1 = await handler(new Request("http://local/topic-dup", { method: "POST", body: JSON.stringify(event) }));
      const r2 = await handler(new Request("http://local/topic-dup", { method: "POST", body: JSON.stringify(event) }));

      expect((await r1.json()).duplicate).toBe(false);
      expect((await r2.json()).duplicate).toBe(true);
    });
  });

  describe("GET /:topic/sse", () => {
    it("returns event-stream", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/topic-sse/sse"));

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
    });

    it("sends connect comment", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/topic-sse/sse"));
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toContain(": connected");
    });

    it("supports once parameter", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/topic-sse/sse?once=1"));
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(body).toContain(": connected");
    });

    it("supports since_id parameter", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/topic-since/sse?since_id=5"));

      expect(res.status).toBe(200);
    });
  });

  describe("GET /registry/:network_id/devices", () => {
    it("lists devices", async () => {
      const handler = testHandler();

      await handler(new Request("http://local/topic-reg", {
        method: "POST",
        body: JSON.stringify({
          type: "device.announce",
          event_id: "evt_reg",
          network_id: "net_reg",
          from_device_id: "dev_reg",
          timestamp: new Date().toISOString(),
          payload: { device_name: "Registered" },
        }),
      }));

      const res = await handler(new Request("http://local/registry/net_reg/devices"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.devices.length).toBe(1);
      expect(body.devices[0].device_id).toBe("dev_reg");
    });

    it("excludes removed devices", async () => {
      const handler = testHandler();

      await handler(new Request("http://local/topic-rem", {
        method: "POST",
        body: JSON.stringify({
          type: "device.remove",
          event_id: "evt_rem",
          network_id: "net_rem",
          from_device_id: "dev_rem",
          timestamp: new Date().toISOString(),
          payload: {},
        }),
      }));

      const res = await handler(new Request("http://local/registry/net_rem/devices"));
      const body = await res.json();

      expect(body.devices.length).toBe(0);
    });

    it("includes removed when requested", async () => {
      const handler = testHandler();

      await handler(new Request("http://local/topic-inc", {
        method: "POST",
        body: JSON.stringify({
          type: "device.remove",
          event_id: "evt_inc",
          network_id: "net_inc",
          from_device_id: "dev_inc",
          timestamp: new Date().toISOString(),
          payload: {},
        }),
      }));

      const res = await handler(new Request("http://local/registry/net_inc/devices?include_removed=1"));
      const body = await res.json();

      expect(body.devices[0]?.is_removed).toBe(true);
    });
  });

  describe("GET /health", () => {
    it("returns ok", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/health"));
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.store).toBe("memory");
    });
  });

  describe("GET /v1/webpush", () => {
    it("returns public key when set", async () => {
      const store = new InMemoryStore(72 * 60 * 60 * 1000, "test_key_123");
      const handler = createRelayHandler(store);
      const res = await handler(new Request("http://local/v1/webpush"));
      const body = await res.json();

      expect(body.public_key).toBe("test_key_123");
    });

    it("returns 404 when not configured", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/v1/webpush"));

      expect(res.status).toBe(404);
    });
  });

  describe("POST|DELETE /:topic/webpush", () => {
    it("registers subscription", async () => {
      const store = new InMemoryStore();
      const handler = createRelayHandler(store);
      const sub = { endpoint: "https://push.example/1", keys: {} };

      const res = await handler(new Request("http://local/topic-push/webpush", {
        method: "POST",
        body: JSON.stringify(sub),
      }));

      expect(res.status).toBe(200);
    });

    it("removes subscription", async () => {
      const store = new InMemoryStore();
      const handler = createRelayHandler(store);
      const sub = { endpoint: "https://push.example/1", keys: {} };

      await handler(new Request("http://local/topic-pushrem/webpush", { method: "POST", body: JSON.stringify(sub) }));
      const res = await handler(new Request("http://local/topic-pushrem/webpush", { method: "DELETE", body: JSON.stringify(sub) }));

      expect(res.status).toBe(200);
    });
  });

  describe("CORS", () => {
    it("handles OPTIONS", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/health", { method: "OPTIONS" }));

      expect(res.status).toBe(204);
    });

    it("includes CORS headers", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/health"));

      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });

  describe("error cases", () => {
    it("returns 404 for unknown path", async () => {
      const handler = testHandler();
      const res = await handler(new Request("http://local/unknown"));

      expect(res.status).toBe(404);
    });
  });
});