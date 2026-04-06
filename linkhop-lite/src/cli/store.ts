import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DeviceConfig, DeviceRecord, EventLogEntry, LocalState, MessageRecord } from "../protocol/types.js";
import { createEmptyState } from "../engine/state.js";

const DATA_DIR = join(process.cwd(), ".linkhop-lite");
const CONFIG_FILE = join(DATA_DIR, "config.json");
const STATE_FILE = join(DATA_DIR, "state.json");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// --- Config persistence ---

export interface CLIConfig {
  device: DeviceConfig;
  password?: string;
  encryption_enabled?: boolean;
}

export function saveConfig(config: CLIConfig): void {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function loadConfig(): CLIConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  // Migrate legacy format (bare DeviceConfig without wrapper)
  if (raw.device_id && !raw.device) {
    return { device: raw as DeviceConfig };
  }
  return raw as CLIConfig;
}

// --- State persistence ---

interface SerializedState {
  devices: [string, DeviceRecord][];
  messages: [string, MessageRecord][];
  eventLog: EventLogEntry[];
}

export function saveState(state: LocalState): void {
  ensureDir();
  const serialized: SerializedState = {
    devices: [...state.devices.entries()],
    messages: [...state.messages.entries()],
    eventLog: state.eventLog,
  };
  writeFileSync(STATE_FILE, JSON.stringify(serialized, null, 2));
}

export function loadState(): LocalState {
  if (!existsSync(STATE_FILE)) return createEmptyState();
  const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as SerializedState;
  return {
    devices: new Map(raw.devices),
    messages: new Map(raw.messages),
    eventLog: raw.eventLog ?? [],
  };
}
