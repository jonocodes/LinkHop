import { describe, it, expect } from "vitest";
import { createRelayHandler, InMemoryStore } from "../src/relay/core.js";



async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 1000): Promise<string> {
  const decoder = new TextDecoder();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("timed out reading SSE chunk")), timeoutMs);
  });
  const chunk = reader.read().then(({ done, value }) => {
    if (done || !value) return "";
    return decoder.decode(value);
  });
  return Promise.race([chunk, timeout]);
}

function msgSend(overrides: Record<string, unknown> = {}) {
  return {
    type: "msg.send",
    event_id: `evt_msg_${Math.random().toString(36).slice(2, 10)}`,
    network_id: "net_demo",
    from_device_id: "dev_phone",
    timestamp: new Date().toISOString(),
    payload: {
      msg_id: "msg_1",
      to_device_id: "dev_desktop",
      body: { kind: "text", text: "hello" },
    },
    ...overrides,
  };
}

function deviceAnnounce(overrides: Record<string, unknown> = {}) {
  return {
    type: "device.announce",
    event_id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    network_id: "net_demo",
    from_device_id: "dev_phone",
    timestamp: new Date().toISOString(),
    payload: {
      device_id: "dev_phone",
      device_name: "Phone",
      device_topic: "linkhop-demo-net_demo-device-dev_phone",
      capabilities: [],
    },
    ...overrides,
  };
}

describe("relay core in memory mode (no postgres)", () => {
  it("answers CORS preflight for browser publish requests", async () => {
    const handler = createRelayHandler(new InMemoryStore());
    const res = await handler(new Request("http://relay.local/topic-a", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    }));

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
  });

  it("serves health and reports memory store", async () => {
    const handler = createRelayHandler(new InMemoryStore());
    const res = await handler(new Request("http://relay.local/health"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.store).toBe("memory");
  });

  it("publishes device announce and returns it from durable registry endpoint", async () => {
    const handler = createRelayHandler(new InMemoryStore());

    const publish = await handler(new Request("http://relay.local/topic-a", {
      method: "POST",
      body: JSON.stringify(deviceAnnounce()),
    }));
    expect(publish.status).toBe(202);

    const devices = await handler(new Request("http://relay.local/registry/net_demo/devices"));
    const payload = await devices.json();

    expect(devices.status).toBe(200);
    expect(payload.devices.length).toBe(1);
    expect(payload.devices[0].device_id).toBe("dev_phone");
    expect(payload.devices[0].is_removed).toBe(false);
  });

  it("dedupes publish by network_id + event_id", async () => {
    const handler = createRelayHandler(new InMemoryStore());
    const event = deviceAnnounce({ event_id: "evt_fixed" });

    const first = await handler(new Request("http://relay.local/topic-a", {
      method: "POST",
      body: JSON.stringify(event),
    }));
    const second = await handler(new Request("http://relay.local/topic-a", {
      method: "POST",
      body: JSON.stringify(event),
    }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);
  });

  it("keeps durable device registry even when short-lived message retention expires", async () => {
    const handler = createRelayHandler(new InMemoryStore(1));

    await handler(new Request("http://relay.local/topic-a", {
      method: "POST",
      body: JSON.stringify(deviceAnnounce()),
    }));

    await new Promise((r) => setTimeout(r, 5));

    const devices = await handler(new Request("http://relay.local/registry/net_demo/devices"));
    const payload = await devices.json();

    expect(devices.status).toBe(200);
    expect(payload.devices.length).toBe(1);
    expect(payload.devices[0].device_id).toBe("dev_phone");
  });



  it("streams live SSE events in memory mode without polling", async () => {
    const store = new InMemoryStore();
    const handler = createRelayHandler(store);
    const ac = new AbortController();

    const sseRes = await handler(new Request("http://relay.local/topic-live/sse", {
      signal: ac.signal,
    }));

    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();

    // Initial connect comment
    const initial = await readChunk(reader);
    expect(initial).toContain(": connected");

    await handler(new Request("http://relay.local/topic-live", {
      method: "POST",
      body: JSON.stringify(deviceAnnounce({ event_id: "evt_live_1" })),
    }));

    const next = await readChunk(reader);
    expect(next).toContain("event: message");
    expect(next).toContain("evt_live_1");

    ac.abort();
    await reader.cancel();
  });





  it("queues push deliveries on msg.send when topic has subscriptions", async () => {
    const handler = createRelayHandler(new InMemoryStore(72 * 60 * 60 * 1000, "demo_public_key"));
    const sub = {
      endpoint: "https://push.example/sub/123",
      keys: { p256dh: "abc", auth: "def" },
    };

    await handler(new Request("http://relay.local/topic-a/webpush", {
      method: "POST",
      body: JSON.stringify(sub),
    }));

    const res = await handler(new Request("http://relay.local/topic-a", {
      method: "POST",
      body: JSON.stringify(msgSend({ event_id: "evt_msg_push" })),
    }));
    const payload = await res.json();

    expect(res.status).toBe(202);
    expect(payload.queued_push).toBe(1);
  });

  it("supports ntfy-compatible webpush endpoints in memory mode", async () => {
    const handler = createRelayHandler(new InMemoryStore(72 * 60 * 60 * 1000, "demo_public_key"));
    const sub = {
      endpoint: "https://push.example/sub/123",
      keys: { p256dh: "abc", auth: "def" },
    };

    const info = await handler(new Request("http://relay.local/v1/webpush"));
    expect(info.status).toBe(200);
    expect((await info.json()).public_key).toBe("demo_public_key");

    const add = await handler(new Request("http://relay.local/topic-a/webpush", {
      method: "POST",
      body: JSON.stringify(sub),
    }));
    expect(add.status).toBe(200);

    const del = await handler(new Request("http://relay.local/topic-a/webpush", {
      method: "DELETE",
      body: JSON.stringify(sub),
    }));
    expect(del.status).toBe(200);
  });

  it("replays events over SSE with since_id and once=1 (local test mode)", async () => {
    const handler = createRelayHandler(new InMemoryStore());

    await handler(new Request("http://relay.local/topic-a", {
      method: "POST",
      body: JSON.stringify(deviceAnnounce({ event_id: "evt_1" })),
    }));
    await handler(new Request("http://relay.local/topic-a", {
      method: "POST",
      body: JSON.stringify(deviceAnnounce({ event_id: "evt_2", from_device_id: "dev_desktop" })),
    }));

    const res = await handler(new Request("http://relay.local/topic-a/sse?since_id=1&once=1"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("id: 2");
    expect(text).toContain("event: message");
    expect(text).toContain("\"event\":\"message\"");
    expect(text).toContain("evt_2");
    expect(text).not.toContain("evt_1");
  });
});
