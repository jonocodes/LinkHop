const SALT_PREFIX = "linkhop-lite-network-v1:";
const ITERATIONS = 100_000;
const KEY_BYTES = 6;

/**
 * Derive a stable network_id from a pool name and shared password.
 * Uses PBKDF2 via Web Crypto — works in browser and Bun/Node.
 *
 * Same pool+password always produces the same network_id.
 * Different pool or password produces different network_ids.
 */
export async function deriveNetworkId(pool: string, password: string): Promise<string> {
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
      salt: encoder.encode(SALT_PREFIX + pool),
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
