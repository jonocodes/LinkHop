import { Database } from '@db/sqlite';
import { dirname } from '@std/path';
import type { AppConfig } from './types.ts';

let db: Database | null = null;

export function getDb(config: AppConfig): Database {
  if (db) {
    return db;
  }

  Deno.mkdirSync(dirname(config.dbPath), { recursive: true });

  db = new Database(config.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      device_type TEXT DEFAULT 'browser',
      browser TEXT,
      os TEXT,
      last_seen_at TEXT,
      last_push_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id),
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth_secret TEXT NOT NULL,
      client_type TEXT,
      user_agent TEXT,
      is_active INTEGER DEFAULT 1,
      last_success_at TEXT,
      last_failure_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  ensureColumn(db, 'push_subscriptions', 'client_type', 'TEXT');
  ensureColumn(db, 'push_subscriptions', 'user_agent', 'TEXT');

  return db;
}

function ensureColumn(
  db: Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const pragma = db.prepare(`PRAGMA table_info(${tableName})`);
  try {
    const columns = pragma.all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      db.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
      );
    }
  } finally {
    pragma.finalize();
  }
}
