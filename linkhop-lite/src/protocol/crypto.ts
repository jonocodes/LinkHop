const ENCRYPTION_SALT_PREFIX = "linkhop-lite-encryption-v1:";
const ITERATIONS = 100_000;
const KEY_BITS = 256;

/**
 * Derive an AES-GCM encryption key from a pool name and shared password.
 * Uses PBKDF2 via Web Crypto with a different salt than network_id derivation.
 */
export async function deriveEncryptionKey(pool: string, password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(ENCRYPTION_SALT_PREFIX + pool),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext message body into ciphertext + IV (base64-encoded).
 */
export async function encryptBody(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: uint8ToBase64(new Uint8Array(encrypted)),
    iv: uint8ToBase64(iv),
  };
}

/**
 * Decrypt a ciphertext + IV back to plaintext.
 * Returns null if decryption fails (wrong key, corrupted data).
 */
export async function decryptBody(
  key: CryptoKey,
  ciphertext: string,
  iv: string,
): Promise<string | null> {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToUint8(iv) as globalThis.BufferSource },
      key,
      base64ToUint8(ciphertext) as globalThis.BufferSource,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
