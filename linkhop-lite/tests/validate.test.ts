import { describe, it, expect } from "vitest";
import { validateEvent } from "../src/protocol/validate.js";
import { makeConfig, makePeerConfig, makeAnnounce, makeMsgSend, makeLeave } from "./helpers.js";

const NET = "net_test";

describe("validateEvent", () => {
  it("accepts a valid device.announce", () => {
    expect(validateEvent(makeAnnounce(makePeerConfig()), NET).valid).toBe(true);
  });

  it("accepts a valid device.leave", () => {
    expect(validateEvent(makeLeave(makePeerConfig()), NET).valid).toBe(true);
  });

  it("accepts a valid msg.send", () => {
    expect(validateEvent(makeMsgSend(makePeerConfig(), "dev_local"), NET).valid).toBe(true);
  });

  it("rejects non-object", () => {
    expect(validateEvent("not an object", NET).valid).toBe(false);
  });

  it("rejects wrong network_id", () => {
    const result = validateEvent(makeAnnounce(makePeerConfig()), "net_other");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("network_id mismatch");
  });

  it("rejects missing envelope fields", () => {
    expect(validateEvent({ type: "device.announce" }, NET).valid).toBe(false);
  });

  it("rejects unknown event type", () => {
    const event = { ...makeAnnounce(makePeerConfig()), type: "bogus.event" };
    const result = validateEvent(event, NET);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("unknown event type");
  });

  it("rejects msg.send with missing msg_id", () => {
    const event = makeMsgSend(makePeerConfig(), "dev_local");
    (event.payload as Record<string, unknown>).msg_id = "";
    expect(validateEvent(event, NET).valid).toBe(false);
  });

  it("rejects device.announce with missing device_name", () => {
    const event = makeAnnounce(makePeerConfig());
    (event.payload as Record<string, unknown>).device_name = "";
    expect(validateEvent(event, NET).valid).toBe(false);
  });
});
