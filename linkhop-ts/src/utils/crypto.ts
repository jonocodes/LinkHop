import { encodeBase64Url } from './base64url.ts';

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function randomToken(prefix = ''): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '')}${
    crypto.randomUUID().replace(/-/g, '')
  }`;
}

export function generateSessionSecret(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function signHmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );

  return encodeBase64Url(signature);
}
