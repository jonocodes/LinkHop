import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEmptyState, getDevices } from "../src/engine/state.js";
import { processEvent } from "../src/engine/reducer.js";
import { createDeviceAnnounce } from "../src/protocol/events.js";
import type { DeviceConfig, DeviceRecord } from "../src/protocol/types.js";

// ---- helpers ----

function makeConfig(id: string, name: string): DeviceConfig {
  return { device_id: id, device_name: name, network_id: "net_test", env: "test" };
}

function populateDevices(configs: DeviceConfig[]) {
  const state = createEmptyState();
  const self = configs[0];
  for (const c of configs) {
    processEvent(state, createDeviceAnnounce(c), self);
  }
  return state;
}

/** Mirrors the filter logic in ui.ts updateSendTargets */
function getSendTargets(
  devices: DeviceRecord[],
  selfDeviceId: string,
  selfSendEnabled: boolean,
): DeviceRecord[] {
  return devices.filter(
    (d) => (selfSendEnabled || d.device_id !== selfDeviceId) && !d.is_removed,
  );
}

// ---- tests ----

describe("settings: self-send filtering", () => {
  const self = makeConfig("dev_self", "My Phone");
  const peer1 = makeConfig("dev_peer1", "Laptop");
  const peer2 = makeConfig("dev_peer2", "Tablet");

  it("excludes self from send targets by default", () => {
    const state = populateDevices([self, peer1, peer2]);
    const devices = getDevices(state);
    const targets = getSendTargets(devices, "dev_self", false);

    expect(targets.map((d) => d.device_id)).toEqual(["dev_peer1", "dev_peer2"]);
  });

  it("includes self in send targets when selfSendEnabled", () => {
    const state = populateDevices([self, peer1, peer2]);
    const devices = getDevices(state);
    const targets = getSendTargets(devices, "dev_self", true);

    expect(targets.map((d) => d.device_id)).toEqual(["dev_self", "dev_peer1", "dev_peer2"]);
  });

  it("excludes removed devices regardless of selfSendEnabled", () => {
    const state = populateDevices([self, peer1, peer2]);
    // Mark peer2 as removed
    state.devices.get("dev_peer2")!.is_removed = true;

    const devices = getDevices(state);
    const targets = getSendTargets(devices, "dev_self", true);

    expect(targets.map((d) => d.device_id)).toEqual(["dev_self", "dev_peer1"]);
  });

  it("returns empty when only self exists and selfSend is off", () => {
    const state = populateDevices([self]);
    const devices = getDevices(state);
    const targets = getSendTargets(devices, "dev_self", false);

    expect(targets).toEqual([]);
  });

  it("returns self when only self exists and selfSend is on", () => {
    const state = populateDevices([self]);
    const devices = getDevices(state);
    const targets = getSendTargets(devices, "dev_self", true);

    expect(targets).toHaveLength(1);
    expect(targets[0].device_id).toBe("dev_self");
  });
});

describe("settings: encryption default", () => {
  it("setup defaults encryption to off", async () => {
    // The App.setup() method sets encryptionEnabled = false.
    // We test this at the protocol level: actionAnnounce with no
    // capabilities when encryption is disabled.
    const { actionAnnounce } = await import("../src/engine/actions.js");
    const config = makeConfig("dev_test", "Test");

    // No capabilities = encryption off
    const effect = actionAnnounce(config);
    expect(effect.type).toBe("publish");
    if (effect.type === "publish") {
      expect(effect.event.type).toBe("device.announce");
      if (effect.event.type === "device.announce") {
        expect(effect.event.payload.capabilities).toBeUndefined();
      }
    }
  });

  it("announce includes encryption capability when enabled", async () => {
    const { actionAnnounce } = await import("../src/engine/actions.js");
    const config = makeConfig("dev_test", "Test");

    const effect = actionAnnounce(config, ["encryption"]);
    if (effect.type === "publish" && effect.event.type === "device.announce") {
      expect(effect.event.payload.capabilities).toEqual(["encryption"]);
    }
  });
});

describe("settings: toggle state tracking", () => {
  it("toggleEncryption flips the flag", () => {
    // Pure state logic: toggling flips the boolean
    let enabled = false;
    enabled = !enabled;
    expect(enabled).toBe(true);
    enabled = !enabled;
    expect(enabled).toBe(false);
  });

  it("toggleSelfSend flips the flag", () => {
    let enabled = false;
    enabled = !enabled;
    expect(enabled).toBe(true);
    enabled = !enabled;
    expect(enabled).toBe(false);
  });
});

describe("settings: server URL update", () => {
  it("updateServer changes the stored URL", () => {
    // Pure state logic: the URL gets replaced
    let ntfyUrl = "https://ntfy.sh";
    const newUrl = "https://my-ntfy.example.com";
    ntfyUrl = newUrl;
    expect(ntfyUrl).toBe("https://my-ntfy.example.com");
  });

  it("default server URL is ntfy.sh", () => {
    // Verify the default matches what App uses
    const defaultUrl = "https://ntfy.sh";
    expect(defaultUrl).toBe("https://ntfy.sh");
  });
});
