import type { Context, MiddlewareHandler } from '@hono/hono';
import { deleteCookie, getCookie, setCookie } from '@hono/hono/cookie';
import type { AppConfig, DeviceRecord, SessionPayload } from '../types.ts';
import { signHmac } from '../utils/crypto.ts';
import { getDeviceByToken, touchDeviceSeen } from '../services/devices.ts';
import { getDb } from '../db.ts';

declare module '@hono/hono' {
  interface ContextVariableMap {
    config: AppConfig;
    session: SessionPayload | null;
    device: DeviceRecord | null;
  }
}

const ONE_DAY_SECONDS = 60 * 60 * 24;

export async function readSession(
  c: Context,
  config: AppConfig,
): Promise<SessionPayload | null> {
  const cookie = getCookie(c, config.sessionCookieName);
  if (!cookie) {
    return null;
  }

  const [encodedPayload, signature] = cookie.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await signHmac(
    config.sessionSecret,
    encodedPayload,
  );
  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(atob(encodedPayload)) as SessionPayload;
    if (payload.expiresAt < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(
  c: Context,
  config: AppConfig,
): Promise<void> {
  const payload: SessionPayload = {
    authenticated: true,
    expiresAt: Date.now() + ONE_DAY_SECONDS * 1000 * 30,
  };
  const encodedPayload = btoa(JSON.stringify(payload));
  const signature = await signHmac(config.sessionSecret, encodedPayload);

  setCookie(c, config.sessionCookieName, `${encodedPayload}.${signature}`, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: c.req.url.startsWith('https://'),
    maxAge: ONE_DAY_SECONDS * 30,
  });
}

export function clearSessionCookie(c: Context, config: AppConfig): void {
  deleteCookie(c, config.sessionCookieName, { path: '/' });
}

export function setDeviceCookie(
  c: Context,
  config: AppConfig,
  token: string,
): void {
  setCookie(c, config.deviceCookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: c.req.url.startsWith('https://'),
    maxAge: ONE_DAY_SECONDS * 365,
  });
}

export function optionalAuth(): MiddlewareHandler {
  return async (c, next) => {
    const config = c.get('config');
    const session = await readSession(c, config);
    c.set('session', session);

    let device: DeviceRecord | null = null;
    const db = getDb(config);
    const bearerRaw =
      c.req.header('authorization')?.replace(/^Bearer\s+/i, '')?.trim() || '';
    const bearer =
      bearerRaw === 'undefined' || bearerRaw === 'null' || bearerRaw === ''
        ? ''
        : bearerRaw;
    const cookieToken = getCookie(c, config.deviceCookieName) || '';

    if (bearer) {
      device = await getDeviceByToken(db, bearer);
    }
    if (!device && cookieToken) {
      device = await getDeviceByToken(db, cookieToken);
    }
    if (device) {
      touchDeviceSeen(db, device.id);
    }

    c.set('device', device);
    await next();
  };
}

/** Pathname for API vs HTML: mounted apps see relative `c.req.path` (e.g. `/me`), not `/api/me`. */
function requestPathname(c: Context): string {
  try {
    return new URL(c.req.url).pathname;
  } catch {
    return c.req.path;
  }
}

export function requireSession(): MiddlewareHandler {
  return async (c, next) => {
    if (!c.get('session')) {
      // API routes should return 401, page routes redirect
      if (requestPathname(c).startsWith('/api/')) {
        return c.json({ error: 'session required' }, 401);
      }
      return c.redirect('/login');
    }
    await next();
  };
}

export function requireDevice(): MiddlewareHandler {
  return async (c, next) => {
    if (!c.get('device')) {
      return c.redirect('/account/activate-device');
    }
    await next();
  };
}

export function requireDeviceToken(): MiddlewareHandler {
  return async (c, next) => {
    if (!c.get('device')) {
      return c.json({ error: 'device authentication required' }, 401);
    }
    await next();
  };
}
