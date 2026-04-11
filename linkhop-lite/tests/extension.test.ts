import { describe, it, expect } from "vitest";
import "../extension/background-core.js";

// background-core.js puts BackgroundCore on globalThis when loaded
const {
  registryTopic,
  deviceTopic,
  parseSSEMessage,
  isMessageForDevice,
  getAppUrlPattern,
  extractConfig,
  DEFAULT_APP_URL,
} = (globalThis as any).BackgroundCore;

// --- Test config fixtures ---

const testConfig = {
  device_id: "dev_abc123",
  device_name: "My Laptop",
  network_id: "net_xyz789",
  env: "live",
  ntfy_url: "https://ntfy.sh",
};

const testBrowserConfig = {
  device: {
    device_id: "dev_abc123",
    device_name: "My Laptop",
    network_id: "net_xyz789",
    env: "live",
  },
  ntfy_url: "https://ntfy.sh",
  pool: "my-pool",
  password: "secret",
};

// --- Topic helpers ---

describe("registryTopic", () => {
  it("builds the correct registry topic", () => {
    expect(registryTopic(testConfig)).toBe("linkhop-live-net_xyz789-registry");
  });

  it("uses env and network_id", () => {
    expect(registryTopic({ ...testConfig, env: "test", network_id: "net_other" }))
      .toBe("linkhop-test-net_other-registry");
  });
});

describe("deviceTopic", () => {
  it("builds the correct device topic", () => {
    expect(deviceTopic(testConfig)).toBe("linkhop-live-net_xyz789-device-dev_abc123");
  });
});

// --- SSE message parsing ---

describe("parseSSEMessage", () => {
  it("parses ntfy-wrapped SSE message", () => {
    const inner = {
      type: "msg.send",
      event_id: "evt_1",
      from_device_id: "dev_sender",
      payload: { msg_id: "msg_1", to_device_id: "dev_abc123", body: { kind: "text", text: "hi" } },
    };
    const data = JSON.stringify({ event: "message", message: JSON.stringify(inner) });
    const result = parseSSEMessage(data);
    expect(result).toEqual(inner);
  });

  it("parses direct protocol event", () => {
    const event = {
      type: "device.announce",
      event_id: "evt_2",
      from_device_id: "dev_other",
      payload: {},
    };
    const data = JSON.stringify(event);
    expect(parseSSEMessage(data)).toEqual(event);
  });

  it("returns null for non-JSON data", () => {
    expect(parseSSEMessage("not json")).toBeNull();
  });

  it("returns null for ntfy wrapper with non-JSON message", () => {
    const data = JSON.stringify({ event: "message", message: "plain text" });
    expect(parseSSEMessage(data)).toBeNull();
  });

  it("returns null for JSON without type or event_id", () => {
    const data = JSON.stringify({ foo: "bar" });
    expect(parseSSEMessage(data)).toBeNull();
  });

  it("returns null for ntfy open event", () => {
    const data = JSON.stringify({ event: "open" });
    expect(parseSSEMessage(data)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSSEMessage("")).toBeNull();
  });
});

// --- Message filtering ---

describe("isMessageForDevice", () => {
  const msgEvent = {
    type: "msg.send",
    payload: { to_device_id: "dev_abc123", msg_id: "msg_1", body: { kind: "text", text: "hi" } },
  };

  it("returns true when msg.send is addressed to our device", () => {
    expect(isMessageForDevice(msgEvent, "dev_abc123")).toBe(true);
  });

  it("returns false when msg.send is for a different device", () => {
    expect(isMessageForDevice(msgEvent, "dev_other")).toBe(false);
  });

  it("returns false for non-msg.send events", () => {
    const announce = { type: "device.announce", payload: { device_id: "dev_abc123" } };
    expect(isMessageForDevice(announce, "dev_abc123")).toBe(false);
  });

  it("returns false for null event", () => {
    expect(isMessageForDevice(null, "dev_abc123")).toBeFalsy();
  });

  it("returns false for event with no payload", () => {
    expect(isMessageForDevice({ type: "msg.send" }, "dev_abc123")).toBe(false);
  });
});

// --- URL pattern ---

describe("getAppUrlPattern", () => {
  it("appends wildcard to URL", () => {
    expect(getAppUrlPattern("https://example.com/app")).toBe("https://example.com/app*");
  });

  it("strips trailing slashes before appending wildcard", () => {
    expect(getAppUrlPattern("https://example.com/app/")).toBe("https://example.com/app*");
    expect(getAppUrlPattern("https://example.com/app///")).toBe("https://example.com/app*");
  });

  it("works with default app URL", () => {
    expect(getAppUrlPattern(DEFAULT_APP_URL)).toBe(
      "https://jonocodes.github.io/LinkHop*"
    );
  });
});

// --- Config extraction ---

describe("extractConfig", () => {
  it("extracts config from a BrowserConfig object", () => {
    const result = extractConfig(testBrowserConfig);
    expect(result).toEqual({
      device_id: "dev_abc123",
      device_name: "My Laptop",
      network_id: "net_xyz789",
      env: "live",
      ntfy_url: "https://ntfy.sh",
    });
  });

  it("returns null if device is missing", () => {
    expect(extractConfig({ ntfy_url: "https://ntfy.sh" })).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractConfig(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractConfig(undefined)).toBeNull();
  });


  it("prefers transport_url when present (relay mode compatibility)", () => {
    const result = extractConfig({
      device: testBrowserConfig.device,
      transport_kind: "relay",
      transport_url: "https://relay.local",
      ntfy_url: "https://ntfy.sh",
    });
    expect(result?.ntfy_url).toBe("https://relay.local");
  });

  it("strips extra fields (pool, password, encryption)", () => {
    const result = extractConfig(testBrowserConfig);
    expect(result).not.toHaveProperty("pool");
    expect(result).not.toHaveProperty("password");
  });
});

// --- DEFAULT_APP_URL ---

describe("DEFAULT_APP_URL", () => {
  it("points to GitHub Pages", () => {
    expect(DEFAULT_APP_URL).toBe("https://jonocodes.github.io/LinkHop/");
  });
});
