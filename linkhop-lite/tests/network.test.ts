import { describe, it, expect } from "vitest";
import { deriveNetworkId } from "../src/protocol/network.js";

describe("deriveNetworkId", () => {
  it("produces a stable net_ prefixed ID", async () => {
    const id = await deriveNetworkId("my-pool", "my-secret-password");
    expect(id).toMatch(/^net_[0-9a-f]{12}$/);
  });

  it("same pool+password produces the same ID", async () => {
    const a = await deriveNetworkId("pool", "shared-password");
    const b = await deriveNetworkId("pool", "shared-password");
    expect(a).toBe(b);
  });

  it("different passwords produce different IDs", async () => {
    const a = await deriveNetworkId("pool", "password-one");
    const b = await deriveNetworkId("pool", "password-two");
    expect(a).not.toBe(b);
  });

  it("different pools with same password produce different IDs", async () => {
    const a = await deriveNetworkId("alice-family", "same-password");
    const b = await deriveNetworkId("bob-team", "same-password");
    expect(a).not.toBe(b);
  });
});
