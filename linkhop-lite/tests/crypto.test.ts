import { describe, it, expect } from "vitest";
import { deriveEncryptionKey, encryptBody, decryptBody } from "../src/protocol/crypto.js";
import { generateNetworkSecret } from "../src/protocol/network.js";

describe("deriveEncryptionKey", () => {
  it("derives a CryptoKey from a network secret", async () => {
    const key = await deriveEncryptionKey(generateNetworkSecret());
    expect(key).toBeDefined();
    expect(key.type).toBe("secret");
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
  });

  it("same networkSecret produces equivalent keys (round-trip)", async () => {
    const secret = generateNetworkSecret();
    const key1 = await deriveEncryptionKey(secret);
    const key2 = await deriveEncryptionKey(secret);
    const { ciphertext, iv } = await encryptBody(key1, "hello");
    expect(await decryptBody(key2, ciphertext, iv)).toBe("hello");
  });

  it("different secrets produce different keys", async () => {
    const key1 = await deriveEncryptionKey(generateNetworkSecret());
    const key2 = await deriveEncryptionKey(generateNetworkSecret());
    const { ciphertext, iv } = await encryptBody(key1, "secret");
    expect(await decryptBody(key2, ciphertext, iv)).toBeNull();
  });
});

describe("encryptBody / decryptBody", () => {
  it("round-trips plaintext", async () => {
    const key = await deriveEncryptionKey(generateNetworkSecret());
    const plain = JSON.stringify({ kind: "text", text: "hello world" });
    const { ciphertext, iv } = await encryptBody(key, plain);
    expect(ciphertext).not.toBe(plain);
    expect(await decryptBody(key, ciphertext, iv)).toBe(plain);
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const key = await deriveEncryptionKey(generateNetworkSecret());
    const a = await encryptBody(key, "same message");
    const b = await encryptBody(key, "same message");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("returns null for corrupted ciphertext", async () => {
    const key = await deriveEncryptionKey(generateNetworkSecret());
    expect(await decryptBody(key, "not-valid-base64!!", "AAAAAAAAAAAAAAAA")).toBeNull();
  });

  it("returns null for wrong key", async () => {
    const keyA = await deriveEncryptionKey(generateNetworkSecret());
    const keyB = await deriveEncryptionKey(generateNetworkSecret());
    const { ciphertext, iv } = await encryptBody(keyA, "secret data");
    expect(await decryptBody(keyB, ciphertext, iv)).toBeNull();
  });
});
