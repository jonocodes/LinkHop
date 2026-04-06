import { describe, it, expect } from "vitest";
import { deriveEncryptionKey, encryptBody, decryptBody } from "../src/protocol/crypto.js";

describe("deriveEncryptionKey", () => {
  it("derives a CryptoKey from pool+password", async () => {
    const key = await deriveEncryptionKey("pool", "test-password");
    expect(key).toBeDefined();
    expect(key.type).toBe("secret");
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
  });

  it("same pool+password produces equivalent keys", async () => {
    const key1 = await deriveEncryptionKey("pool", "same-password");
    const key2 = await deriveEncryptionKey("pool", "same-password");
    // Encrypt with key1, decrypt with key2 — should work
    const { ciphertext, iv } = await encryptBody(key1, "hello");
    const result = await decryptBody(key2, ciphertext, iv);
    expect(result).toBe("hello");
  });

  it("different passwords produce different keys", async () => {
    const key1 = await deriveEncryptionKey("pool", "password-a");
    const key2 = await deriveEncryptionKey("pool", "password-b");
    const { ciphertext, iv } = await encryptBody(key1, "secret");
    const result = await decryptBody(key2, ciphertext, iv);
    expect(result).toBeNull();
  });

  it("different pools with same password produce different keys", async () => {
    const key1 = await deriveEncryptionKey("alice", "same-password");
    const key2 = await deriveEncryptionKey("bob", "same-password");
    const { ciphertext, iv } = await encryptBody(key1, "secret");
    const result = await decryptBody(key2, ciphertext, iv);
    expect(result).toBeNull();
  });
});

describe("encryptBody / decryptBody", () => {
  it("round-trips plaintext through encrypt then decrypt", async () => {
    const key = await deriveEncryptionKey("pool", "round-trip");
    const plain = JSON.stringify({ kind: "text", text: "hello world" });
    const { ciphertext, iv } = await encryptBody(key, plain);
    expect(ciphertext).toBeTruthy();
    expect(iv).toBeTruthy();
    expect(ciphertext).not.toBe(plain);

    const result = await decryptBody(key, ciphertext, iv);
    expect(result).toBe(plain);
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const key = await deriveEncryptionKey("pool", "iv-test");
    const plain = "same message";
    const a = await encryptBody(key, plain);
    const b = await encryptBody(key, plain);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("returns null for corrupted ciphertext", async () => {
    const key = await deriveEncryptionKey("pool", "corrupt-test");
    const result = await decryptBody(key, "not-valid-base64!!", "AAAAAAAAAAAAAAAA");
    expect(result).toBeNull();
  });

  it("returns null for wrong key", async () => {
    const keyA = await deriveEncryptionKey("pool", "key-a");
    const keyB = await deriveEncryptionKey("pool", "key-b");
    const { ciphertext, iv } = await encryptBody(keyA, "secret data");
    const result = await decryptBody(keyB, ciphertext, iv);
    expect(result).toBeNull();
  });
});
