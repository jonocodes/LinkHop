const SALT = "linkhop-lite-network-v1";
const ITERATIONS = 100_000;
const KEY_BYTES = 12;

/**
 * Derive a stable network_id from a shared password.
 * Uses PBKDF2 via Web Crypto — works in browser and Bun/Node.
 *
 * Same password always produces the same network_id.
 * Different passwords produce different network_ids.
 */
export async function deriveNetworkId(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(SALT),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_BYTES * 8,
  );

  const hex = [...new Uint8Array(bits)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `net_${hex}`;
}
