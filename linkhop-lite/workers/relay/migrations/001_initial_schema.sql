-- LinkHop Relay D1 Schema
-- Migration: 001_initial_schema.sql

-- Events table with idempotent writes based on network_id + event_id
CREATE TABLE IF NOT EXISTS linkhop_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  from_device_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_ts TEXT NOT NULL,
  envelope TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(network_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_linkhop_events_topic_id ON linkhop_events(topic, id);
CREATE INDEX IF NOT EXISTS idx_linkhop_events_network_id ON linkhop_events(network_id);
CREATE INDEX IF NOT EXISTS idx_linkhop_events_created_at ON linkhop_events(created_at);

-- Device registry table
CREATE TABLE IF NOT EXISTS linkhop_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_topic TEXT NOT NULL,
  device_name TEXT NOT NULL,
  device_kind TEXT,
  capabilities TEXT DEFAULT '[]',
  last_event_type TEXT NOT NULL,
  last_event_at TEXT NOT NULL,
  is_removed INTEGER DEFAULT 0,
  UNIQUE(network_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_linkhop_devices_network_id ON linkhop_devices(network_id);
CREATE INDEX IF NOT EXISTS idx_linkhop_devices_last_event_at ON linkhop_devices(last_event_at);

-- WebPush subscriptions table
CREATE TABLE IF NOT EXISTS linkhop_webpush_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  subscription TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(topic, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_linkhop_webpush_subscriptions_topic ON linkhop_webpush_subscriptions(topic);

-- WebPush delivery queue table
CREATE TABLE IF NOT EXISTS linkhop_webpush_delivery_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'queued',
  created_at TEXT DEFAULT (datetime('now')),
  delivered_at TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_linkhop_webpush_delivery_queue_status ON linkhop_webpush_delivery_queue(status);
CREATE INDEX IF NOT EXISTS idx_linkhop_webpush_delivery_queue_topic ON linkhop_webpush_delivery_queue(topic);