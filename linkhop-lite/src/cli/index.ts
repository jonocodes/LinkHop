#!/usr/bin/env node

import { parseArgs } from "node:util";
import { loadConfig, loadState, saveConfig, saveState } from "./store.js";
import { generateDeviceId, generateNetworkId } from "../protocol/ids.js";
import { deviceTopicFromConfig, registryTopicFromConfig } from "../protocol/topics.js";
import { actionAnnounce, actionLeave, actionSend } from "../engine/actions.js";
import { processEvent } from "../engine/reducer.js";
import { validateEvent } from "../protocol/validate.js";
import { getDevices, getInbox, getPending } from "../engine/state.js";
import { publish, subscribe } from "../transport/ntfy.js";
import type { AnyProtocolEvent, DeviceConfig, LocalState } from "../protocol/types.js";
import type { Effect } from "../engine/reducer.js";

async function executeEffect(effect: Effect): Promise<void> {
  switch (effect.type) {
    case "publish":
      await publish(effect.topic, effect.event);
      console.log(`  → published ${effect.event.type} to ${effect.topic}`);
      break;
    case "log":
      console.log(`  [log] ${effect.message}`);
      break;
  }
}

function requireConfig(): DeviceConfig {
  const config = loadConfig();
  if (!config) {
    console.error("Not initialized. Run: linkhop-lite init");
    process.exit(1);
  }
  return config;
}

// --- Commands ---

async function cmdInit(args: string[]): Promise<void> {
  const existing = loadConfig();
  if (existing) {
    console.log(`Already initialized as ${existing.device_name} (${existing.device_id})`);
    return;
  }

  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string", short: "n" },
      network: { type: "string" },
      env: { type: "string", default: "test" },
    },
    strict: false,
  });

  const config: DeviceConfig = {
    device_id: generateDeviceId(),
    device_name: (values.name as string) ?? `device-${Date.now()}`,
    network_id: (values.network as string) ?? generateNetworkId(),
    env: (values.env as string) ?? "test",
  };

  saveConfig(config);
  console.log(`Initialized device:`);
  console.log(`  device_id:  ${config.device_id}`);
  console.log(`  name:       ${config.device_name}`);
  console.log(`  network_id: ${config.network_id}`);
  console.log(`  env:        ${config.env}`);
}

function cmdWhoami(): void {
  const config = requireConfig();
  console.log(`device_id:      ${config.device_id}`);
  console.log(`device_name:    ${config.device_name}`);
  console.log(`network_id:     ${config.network_id}`);
  console.log(`env:            ${config.env}`);
  console.log(`registry_topic: ${registryTopicFromConfig(config)}`);
  console.log(`device_topic:   ${deviceTopicFromConfig(config)}`);
}

async function cmdAnnounce(): Promise<void> {
  const config = requireConfig();
  const effect = actionAnnounce(config);
  await executeEffect(effect);
}

async function cmdLeave(): Promise<void> {
  const config = requireConfig();
  const effect = actionLeave(config);
  await executeEffect(effect);
}

function cmdDevices(): void {
  const config = requireConfig();
  const state = loadState();
  const devices = getDevices(state);

  if (devices.length === 0) {
    console.log("No known devices.");
    return;
  }

  for (const d of devices) {
    const self = d.device_id === config.device_id ? " (self)" : "";
    const removed = d.is_removed ? " [removed]" : "";
    console.log(`  ${d.device_name} (${d.device_id})${self}${removed}`);
    console.log(`    topic: ${d.device_topic}`);
    console.log(`    last:  ${d.last_event_type} at ${d.last_event_at}`);
  }
}

async function cmdSend(args: string[]): Promise<void> {
  const config = requireConfig();
  const state = loadState();

  const [deviceId, ...textParts] = args;
  if (!deviceId || textParts.length === 0) {
    console.error("Usage: linkhop-lite send <device-id> <text...>");
    process.exit(1);
  }

  const device = state.devices.get(deviceId);
  if (!device) {
    console.error(`Unknown device: ${deviceId}. Run 'watch' to discover devices.`);
    process.exit(1);
  }

  const effect = actionSend(state, config, deviceId, device.device_topic, {
    kind: "text",
    text: textParts.join(" "),
  });

  await executeEffect(effect);
  saveState(state);
  console.log("Message sent and stored as pending.");
}

function cmdInbox(): void {
  const config = requireConfig();
  const state = loadState();
  const inbox = getInbox(state, config.device_id);

  if (inbox.length === 0) {
    console.log("Inbox is empty.");
    return;
  }

  for (const m of inbox) {
    console.log(`  [${m.msg_id}] from ${m.from_device_id} at ${m.created_at}`);
    console.log(`    ${m.body.text}`);
  }
}

function cmdPending(): void {
  const config = requireConfig();
  const state = loadState();
  const pending = getPending(state, config.device_id);

  if (pending.length === 0) {
    console.log("No pending messages.");
    return;
  }

  for (const m of pending) {
    console.log(`  [${m.msg_id}] to ${m.to_device_id} at ${m.created_at}`);
    console.log(`    ${m.body.text}`);
    console.log(`    attempt: ${m.last_attempt_id} at ${m.last_attempt_at}`);
  }
}

async function cmdWatch(): Promise<void> {
  const config = requireConfig();
  const state = loadState();

  const registryTopic = registryTopicFromConfig(config);
  const deviceTopic = deviceTopicFromConfig(config);

  console.log(`Watching topics:`);
  console.log(`  registry: ${registryTopic}`);
  console.log(`  device:   ${deviceTopic}`);
  console.log();

  function handleRaw(raw: unknown): void {
    const result = validateEvent(raw, config.network_id);
    if (!result.valid) {
      console.log(`  [ignored] ${result.reason}`);
      return;
    }

    console.log(`  ← ${result.event.type} from ${result.event.from_device_id}`);
    const { effects } = processEvent(state, result.event, config);
    saveState(state);

    for (const effect of effects) {
      if (effect.type === "publish") {
        publish(effect.topic, effect.event).then(
          () => console.log(`  → ${effect.event.type} to ${effect.topic}`),
          (err) => console.error(`  [error] publish failed: ${err}`),
        );
      } else if (effect.type === "log") {
        console.log(`  [log] ${effect.message}`);
      }
    }
  }

  subscribe(registryTopic, {
    onEvent: handleRaw,
    onError: (err) => console.error(`[registry error] ${err.message}`),
  });

  subscribe(deviceTopic, {
    onEvent: handleRaw,
    onError: (err) => console.error(`[device error] ${err.message}`),
  });

  // Keep alive
  await new Promise(() => {});
}

function cmdEvents(): void {
  requireConfig();
  const state = loadState();

  if (state.eventLog.length === 0) {
    console.log("No events logged.");
    return;
  }

  console.log(JSON.stringify(state.eventLog, null, 2));
}

function cmdExportState(): void {
  requireConfig();
  const state = loadState();

  const exported = {
    devices: [...state.devices.entries()].map(([, v]) => v),
    messages: [...state.messages.entries()].map(([, v]) => v),
    eventLog: state.eventLog,
  };

  console.log(JSON.stringify(exported, null, 2));
}

// --- Main ---

const [command, ...rest] = process.argv.slice(2);

const commands: Record<string, (args: string[]) => Promise<void> | void> = {
  init: cmdInit,
  whoami: () => cmdWhoami(),
  announce: cmdAnnounce,
  leave: cmdLeave,
  devices: () => cmdDevices(),
  send: cmdSend,
  inbox: () => cmdInbox(),
  pending: () => cmdPending(),
  watch: cmdWatch,
  events: () => cmdEvents(),
  "export-state": () => cmdExportState(),
};

if (!command || !commands[command]) {
  console.log("Usage: linkhop-lite <command>");
  console.log();
  console.log("Commands:");
  console.log("  init              Create device identity and network config");
  console.log("  whoami            Print local device identity");
  console.log("  announce          Emit device.announce");
  console.log("  leave             Emit device.leave");
  console.log("  devices           Show known devices");
  console.log("  send <id> <text>  Send a message to a device");
  console.log("  inbox             Show received messages");
  console.log("  pending           Show pending outbound messages");
  console.log("  watch             Subscribe and display live events");
  console.log("  events            Print event log as JSON");
  console.log("  export-state      Export full local state as JSON");
  process.exit(command ? 1 : 0);
}

Promise.resolve(commands[command](rest)).catch((err) => {
  console.error(err);
  process.exit(1);
});
