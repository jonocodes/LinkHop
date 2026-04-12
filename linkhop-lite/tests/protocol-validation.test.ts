import { describe, it, expect } from "vitest";
import { isProtocolEvent } from "../src/relay/core.js";

const validEvent = {
  type: "device.announce",
  event_id: "evt_proto_1",
  network_id: "net_proto",
  from_device_id: "dev_proto",
  timestamp: new Date().toISOString(),
  payload: { device_name: "Proto Device" },
};

describe("isProtocolEvent validation", () => {
  it("accepts valid event", () => {
    expect(isProtocolEvent(validEvent)).toBe(true);
  });

  it("rejects missing type", () => {
    const e = { ...validEvent };
    delete (e as any).type;
    expect(isProtocolEvent(e)).toBe(false);
  });

  it("rejects missing event_id", () => {
    const e = { ...validEvent };
    delete (e as any).event_id;
    expect(isProtocolEvent(e)).toBe(false);
  });

  it("rejects missing network_id", () => {
    const e = { ...validEvent };
    delete (e as any).network_id;
    expect(isProtocolEvent(e)).toBe(false);
  });

  it("rejects missing from_device_id", () => {
    const e = { ...validEvent };
    delete (e as any).from_device_id;
    expect(isProtocolEvent(e)).toBe(false);
  });

  it("rejects missing timestamp", () => {
    const e = { ...validEvent };
    delete (e as any).timestamp;
    expect(isProtocolEvent(e)).toBe(false);
  });

  it("rejects null", () => {
    expect(isProtocolEvent(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isProtocolEvent(undefined)).toBe(false);
  });

  it("rejects string", () => {
    expect(isProtocolEvent("string")).toBe(false);
  });

  it("rejects number", () => {
    expect(isProtocolEvent(123)).toBe(false);
  });

  it("rejects array", () => {
    expect(isProtocolEvent([])).toBe(false);
  });
});