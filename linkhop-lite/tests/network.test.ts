import { describe, it, expect } from "vitest";
import { deriveNetworkId } from "../src/protocol/network.js";

describe("deriveNetworkId", () => {
  it("produces a stable net_ prefixed ID", async () => {
    const id = await deriveNetworkId("my-secret-password");
    expect(id).toMatch(/^net_[0-9a-f]{12}$/);
  });

  it("same password produces the same ID", async () => {
    const a = await deriveNetworkId("shared-password");
    const b = await deriveNetworkId("shared-password");
    expect(a).toBe(b);
  });

  it("different passwords produce different IDs", async () => {
    const a = await deriveNetworkId("password-one");
    const b = await deriveNetworkId("password-two");
    expect(a).not.toBe(b);
  });
});
