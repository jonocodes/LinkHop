import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryRelay } from "../src/engine/relay.js";
import { SimulatedDevice } from "../src/engine/simulated-device.js";
import { getDevices, getInbox, getPending } from "../src/engine/state.js";
import { deviceTopicFromConfig } from "../src/protocol/topics.js";
import type { DeviceConfig } from "../src/protocol/types.js";

function makeDevice(id: string, name: string): DeviceConfig {
  return {
    device_id: id,
    device_name: name,
    network_id: "net_sim",
    env: "test",
  };
}

describe("two-device simulation", () => {
  let relay: InMemoryRelay;
  let phone: SimulatedDevice;
  let desktop: SimulatedDevice;
  const phoneConfig = makeDevice("dev_phone", "Phone");
  const desktopConfig = makeDevice("dev_desktop", "Desktop");

  beforeEach(() => {
    relay = new InMemoryRelay();
    phone = new SimulatedDevice(phoneConfig, relay);
    desktop = new SimulatedDevice(desktopConfig, relay);
    phone.connect();
    desktop.connect();
  });

  it("devices discover each other via announce", () => {
    phone.announce();
    desktop.announce();

    // Phone knows about desktop
    const phoneDevices = getDevices(phone.state);
    expect(phoneDevices.find((d) => d.device_id === "dev_desktop")).toBeDefined();
    expect(phoneDevices.find((d) => d.device_id === "dev_desktop")!.device_name).toBe("Desktop");

    // Desktop knows about phone
    const desktopDevices = getDevices(desktop.state);
    expect(desktopDevices.find((d) => d.device_id === "dev_phone")).toBeDefined();
  });

  it("full message flow: send, receive, ack", () => {
    // Both announce so they know each other
    phone.announce();
    desktop.announce();

    const desktopTopic = deviceTopicFromConfig(desktopConfig);
    phone.send("dev_desktop", desktopTopic, { kind: "text", text: "hello from phone" });

    // Desktop received the message
    const inbox = getInbox(desktop.state, "dev_desktop");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].body.text).toBe("hello from phone");
    expect(inbox[0].from_device_id).toBe("dev_phone");

    // Phone's pending is cleared by the ack
    expect(getPending(phone.state, "dev_phone")).toHaveLength(0);

    // Phone's message record is now received
    const phoneMsg = [...phone.state.messages.values()][0];
    expect(phoneMsg.state).toBe("received");
  });

  it("device rename is visible to peers after re-announce", () => {
    phone.announce();
    desktop.announce();

    const devBefore = getDevices(phone.state).find((d) => d.device_id === "dev_desktop");
    expect(devBefore!.device_name).toBe("Desktop");

    // Desktop renames and re-announces
    (desktop.config as { device_name: string }).device_name = "Work Desktop";
    desktop.announce();

    const devAfter = getDevices(phone.state).find((d) => d.device_id === "dev_desktop");
    expect(devAfter!.device_name).toBe("Work Desktop");
  });

  it("device.leave marks device as removed on peer", () => {
    phone.announce();
    desktop.announce();

    desktop.leave();

    const dev = getDevices(phone.state).find((d) => d.device_id === "dev_desktop");
    expect(dev!.is_removed).toBe(true);
  });
});

describe("deduplication via relay", () => {
  let relay: InMemoryRelay;
  let phone: SimulatedDevice;
  let desktop: SimulatedDevice;
  const phoneConfig = makeDevice("dev_phone", "Phone");
  const desktopConfig = makeDevice("dev_desktop", "Desktop");

  beforeEach(() => {
    relay = new InMemoryRelay();
    phone = new SimulatedDevice(phoneConfig, relay);
    desktop = new SimulatedDevice(desktopConfig, relay);
    phone.connect();
    desktop.connect();
    phone.announce();
    desktop.announce();
  });

  it("duplicate delivery does not create duplicate inbox entries", () => {
    const desktopTopic = deviceTopicFromConfig(desktopConfig);

    // Tell relay to duplicate the next delivery to desktop's device topic
    relay.duplicateNextDeliveries(desktopTopic, 1);

    phone.send("dev_desktop", desktopTopic, { kind: "text", text: "only once please" });

    const inbox = getInbox(desktop.state, "dev_desktop");
    expect(inbox).toHaveLength(1);
  });
});

describe("dropped ack scenario", () => {
  let relay: InMemoryRelay;
  let phone: SimulatedDevice;
  let desktop: SimulatedDevice;
  const phoneConfig = makeDevice("dev_phone", "Phone");
  const desktopConfig = makeDevice("dev_desktop", "Desktop");

  beforeEach(() => {
    relay = new InMemoryRelay();
    phone = new SimulatedDevice(phoneConfig, relay);
    desktop = new SimulatedDevice(desktopConfig, relay);
    phone.connect();
    desktop.connect();
    phone.announce();
    desktop.announce();
  });

  it("sender stays pending when ack is dropped", () => {
    const desktopTopic = deviceTopicFromConfig(desktopConfig);
    const phoneTopic = deviceTopicFromConfig(phoneConfig);

    // Drop the next publish to phone's device topic (the ack)
    relay.dropNextPublishes(phoneTopic, 1);

    phone.send("dev_desktop", desktopTopic, { kind: "text", text: "will ack be lost?" });

    // Desktop received it
    expect(getInbox(desktop.state, "dev_desktop")).toHaveLength(1);

    // But phone is still pending (ack was dropped)
    expect(getPending(phone.state, "dev_phone")).toHaveLength(1);

    // Verify relay recorded the drop
    expect(relay.dropped).toHaveLength(1);
    expect(relay.dropped[0].type).toBe("msg.received");
  });
});

describe("late subscriber receives retained events", () => {
  it("device connecting after announce still discovers peers", () => {
    const relay = new InMemoryRelay();
    const phoneConfig = makeDevice("dev_phone", "Phone");
    const desktopConfig = makeDevice("dev_desktop", "Desktop");

    const phone = new SimulatedDevice(phoneConfig, relay);
    phone.connect();
    phone.announce();

    // Desktop connects after phone already announced
    const desktop = new SimulatedDevice(desktopConfig, relay);
    desktop.connect();

    const devices = getDevices(desktop.state);
    expect(devices.find((d) => d.device_id === "dev_phone")).toBeDefined();
  });

  it("device misses peer announce if relay retention window has expired", () => {
    // Simulates the real ntfy ?since=30s window: events older than the retention
    // period are NOT delivered to late subscribers.
    vi.useFakeTimers();
    try {
      const relay = new InMemoryRelay({ retentionMs: 1_000 }); // 1 second window
      const phoneConfig = makeDevice("dev_phone", "Phone");
      const desktopConfig = makeDevice("dev_desktop", "Desktop");

      const phone = new SimulatedDevice(phoneConfig, relay);
      phone.connect();
      phone.announce(); // published at T=0

      vi.advanceTimersByTime(2_000); // jump 2 seconds past the 1s retention window

      // Desktop connects after the retention window has expired
      const desktop = new SimulatedDevice(desktopConfig, relay);
      desktop.connect();

      // Desktop should NOT discover phone — the announce is outside the retention window
      const devices = getDevices(desktop.state);
      expect(devices.find((d) => d.device_id === "dev_phone")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("three-device simulation", () => {
  it("message between two devices does not leak to third", () => {
    const relay = new InMemoryRelay();
    const aConfig = makeDevice("dev_a", "A");
    const bConfig = makeDevice("dev_b", "B");
    const cConfig = makeDevice("dev_c", "C");

    const a = new SimulatedDevice(aConfig, relay);
    const b = new SimulatedDevice(bConfig, relay);
    const c = new SimulatedDevice(cConfig, relay);

    a.connect(); b.connect(); c.connect();
    a.announce(); b.announce(); c.announce();

    const bTopic = deviceTopicFromConfig(bConfig);
    a.send("dev_b", bTopic, { kind: "text", text: "private to B" });

    expect(getInbox(b.state, "dev_b")).toHaveLength(1);
    expect(getInbox(c.state, "dev_c")).toHaveLength(0);

    // All three see each other via registry
    expect(getDevices(a.state)).toHaveLength(3);
    expect(getDevices(b.state)).toHaveLength(3);
    expect(getDevices(c.state)).toHaveLength(3);
  });
});
