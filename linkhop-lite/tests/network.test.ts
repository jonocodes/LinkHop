import { describe, it, expect } from "vitest";
import { deriveNetworkId, generateNetworkSecret } from "../src/protocol/network.js";

describe("generateNetworkSecret", () => {
  it("returns a base64 string of length 44", () => {
    const s = generateNetworkSecret();
    expect(typeof s).toBe("string");
    expect(s.length).toBe(44);
  });

  it("returns different values each time", () => {
    expect(generateNetworkSecret()).not.toBe(generateNetworkSecret());
  });
});

describe("deriveNetworkId", () => {
  it("produces a stable net_ prefixed ID", async () => {
    const id = await deriveNetworkId("alice@5apps.com", "my-network-secret");
    expect(id).toMatch(/^net_[0-9a-f]{12}$/);
  });

  it("same rsUser + networkSecret produces the same ID", async () => {
    const secret = generateNetworkSecret();
    const a = await deriveNetworkId("alice@5apps.com", secret);
    const b = await deriveNetworkId("alice@5apps.com", secret);
    expect(a).toBe(b);
  });

  it("different networkSecrets produce different IDs", async () => {
    const a = await deriveNetworkId("alice@5apps.com", generateNetworkSecret());
    const b = await deriveNetworkId("alice@5apps.com", generateNetworkSecret());
    expect(a).not.toBe(b);
  });

  it("different RS users with same secret produce different IDs", async () => {
    const secret = generateNetworkSecret();
    const a = await deriveNetworkId("alice@5apps.com", secret);
    const b = await deriveNetworkId("bob@5apps.com", secret);
    expect(a).not.toBe(b);
  });
});
