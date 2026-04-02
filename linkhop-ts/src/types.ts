export type DeviceType = 'browser' | 'extension' | 'cli' | 'api';

export interface DeviceRecord {
  id: string;
  name: string;
  token_hash: string;
  is_active: number;
  device_type: DeviceType;
  browser: string | null;
  os: string | null;
  last_seen_at: string | null;
  last_push_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface PushSubscriptionRecord {
  id: string;
  device_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  client_type: string | null;
  user_agent: string | null;
  is_active: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface SessionPayload {
  authenticated: true;
  expiresAt: number;
}

export interface AppConfig {
  appDir: string;
  publicDir: string;
  envPath: string;
  host: string;
  port: number;
  dbPath: string;
  passwordHash: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  sessionSecret: string;
  sessionCookieName: string;
  deviceCookieName: string;
  allowSelfSend: boolean;
}
