export function encodeBase64Url(
  data: ArrayBuffer | Uint8Array | string,
): string {
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data instanceof Uint8Array
    ? data
    : new Uint8Array(data);

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(
    /=+$/g,
    '',
  );
}

export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
