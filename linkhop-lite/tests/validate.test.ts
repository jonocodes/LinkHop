import { describe, it, expect } from "vitest";
import { validateEvent } from "../src/protocol/validate.js";
import { makeConfig, makePeerConfig, makeAnnounce, makeHeartbeat, makeMsgSend, makeSyncRequest, makeSyncResponse } from "./helpers.js";

const NET = "net_test";

describe("validateEvent", () => {
  it("accepts a valid device.announce", () => {
    const event = makeAnnounce(makePeerConfig());
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid msg.send", () => {
    const event = makeMsgSend(makePeerConfig(), "dev_local");
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(true);
  });

  it("rejects non-object", () => {
    const result = validateEvent("not an object", NET);
    expect(result.valid).toBe(false);
  });

  it("rejects wrong network_id", () => {
    const event = makeAnnounce(makePeerConfig());
    const result = validateEvent(event, "net_other");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("network_id mismatch");
  });

  it("rejects missing envelope fields", () => {
    const result = validateEvent({ type: "device.announce" }, NET);
    expect(result.valid).toBe(false);
  });

  it("rejects unknown event type", () => {
    const event = { ...makeAnnounce(makePeerConfig()), type: "bogus.event" };
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("unknown event type");
  });

  it("rejects msg.send with missing payload fields", () => {
    const event = makeMsgSend(makePeerConfig(), "dev_local");
    (event.payload as Record<string, unknown>).msg_id = "";
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(false);
  });

  it("accepts a valid device.heartbeat", () => {
    const event = makeHeartbeat(makePeerConfig());
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(true);
  });

  it("rejects device.heartbeat with missing device_id", () => {
    const event = makeHeartbeat(makePeerConfig());
    (event.payload as Record<string, unknown>).device_id = "";
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("device.heartbeat");
  });

  it("accepts a valid sync.request", () => {
    const event = makeSyncRequest(makePeerConfig(), "dev_local");
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(true);
  });

  it("rejects sync.request with missing to_device_id", () => {
    const event = makeSyncRequest(makePeerConfig(), "dev_local");
    (event.payload as Record<string, unknown>).to_device_id = "";
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("sync.request");
  });

  it("accepts a valid sync.response", () => {
    const event = makeSyncResponse(makePeerConfig(), "dev_local", []);
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(true);
  });

  it("rejects sync.response with missing devices array", () => {
    const event = makeSyncResponse(makePeerConfig(), "dev_local", []);
    (event.payload as Record<string, unknown>).devices = "not-array";
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("sync.response");
  });

  it("rejects sync.response with missing to_device_id", () => {
    const event = makeSyncResponse(makePeerConfig(), "dev_local", []);
    (event.payload as Record<string, unknown>).to_device_id = "";
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(false);
  });
});
