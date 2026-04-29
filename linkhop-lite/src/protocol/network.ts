const HMAC_LABEL = "linkhop:network-id-v2";
const ID_BYTES = 6;

/**
 * Derive a stable network_id from the RS user address and the network secret.
 * Uses HMAC-SHA-256 — same inputs always produce the same network_id.
 */
export async function deriveNetworkId(rsUser: string, networkSecret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(networkSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(HMAC_LABEL + ":" + rsUser),
  );
  const hex = [...new Uint8Array(sig)]
    .slice(0, ID_BYTES)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `net_${hex}`;
}

/** Generate a random 32-byte base64 network secret for first-time setup. */
export function generateNetworkSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
