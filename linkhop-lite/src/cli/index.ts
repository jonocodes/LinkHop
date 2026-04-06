#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig, loadState, saveConfig, saveState } from "./store.js";
import { generateDeviceId, generateNetworkId } from "../protocol/ids.js";
import { deviceTopicFromConfig, registryTopicFromConfig } from "../protocol/topics.js";
import { actionAnnounce, actionLeave, actionSend } from "../engine/actions.js";
import { processEvent } from "../engine/reducer.js";
import { validateEvent } from "../protocol/validate.js";
import { getDevices, getInbox, getPending } from "../engine/state.js";
import { publish, subscribe } from "../transport/ntfy.js";
import type { DeviceConfig } from "../protocol/types.js";
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

const program = new Command()
  .name("linkhop-lite")
  .description("LinkHop Lite reference CLI")
  .version("0.1.0");

program
  .command("init")
  .description("Create device identity and network config")
  .option("-n, --name <name>", "device display name")
  .option("--network <id>", "network ID to join")
  .option("--env <env>", "environment", "test")
  .action(async (opts) => {
    const existing = loadConfig();
    if (existing) {
      console.log(`Already initialized as ${existing.device_name} (${existing.device_id})`);
      return;
    }

    const config: DeviceConfig = {
      device_id: generateDeviceId(),
      device_name: opts.name ?? `device-${Date.now()}`,
      network_id: opts.network ?? generateNetworkId(),
      env: opts.env,
    };

    saveConfig(config);
    console.log(`Initialized device:`);
    console.log(`  device_id:  ${config.device_id}`);
    console.log(`  name:       ${config.device_name}`);
    console.log(`  network_id: ${config.network_id}`);
    console.log(`  env:        ${config.env}`);
  });

program
  .command("whoami")
  .description("Print local device identity and topics")
  .action(() => {
    const config = requireConfig();
    console.log(`device_id:      ${config.device_id}`);
    console.log(`device_name:    ${config.device_name}`);
    console.log(`network_id:     ${config.network_id}`);
    console.log(`env:            ${config.env}`);
    console.log(`registry_topic: ${registryTopicFromConfig(config)}`);
    console.log(`device_topic:   ${deviceTopicFromConfig(config)}`);
  });

program
  .command("announce")
  .description("Emit device.announce to the registry topic")
  .action(async () => {
    const config = requireConfig();
    await executeEffect(actionAnnounce(config));
  });

program
  .command("leave")
  .description("Emit device.leave to the registry topic")
  .action(async () => {
    const config = requireConfig();
    await executeEffect(actionLeave(config));
  });

program
  .command("devices")
  .description("Show locally known devices")
  .action(() => {
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
  });

program
  .command("send")
  .description("Send a message to a device")
  .argument("<device-id>", "target device ID")
  .argument("<text...>", "message text")
  .action(async (deviceId: string, textParts: string[]) => {
    const config = requireConfig();
    const state = loadState();

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
  });

program
  .command("inbox")
  .description("Show received messages")
  .action(() => {
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
  });

program
  .command("pending")
  .description("Show pending outbound messages")
  .action(() => {
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
  });

program
  .command("watch")
  .description("Subscribe and display live events")
  .action(async () => {
    const config = requireConfig();
    const state = loadState();

    const regTopic = registryTopicFromConfig(config);
    const devTopic = deviceTopicFromConfig(config);

    console.log(`Watching topics:`);
    console.log(`  registry: ${regTopic}`);
    console.log(`  device:   ${devTopic}`);
    console.log();

    function handleRaw(raw: unknown): void {
      const result = validateEvent(raw, config.network_id);
      if (!result.valid) {
        console.log(`  [ignored] ${result.reason}`);
        return;
      }

      console.log(`  <- ${result.event.type} from ${result.event.from_device_id}`);
      const { effects } = processEvent(state, result.event, config);
      saveState(state);

      for (const effect of effects) {
        if (effect.type === "publish") {
          publish(effect.topic, effect.event).then(
            () => console.log(`  -> ${effect.event.type} to ${effect.topic}`),
            (err) => console.error(`  [error] publish failed: ${err}`),
          );
        } else if (effect.type === "log") {
          console.log(`  [log] ${effect.message}`);
        }
      }
    }

    subscribe(regTopic, {
      onEvent: handleRaw,
      onError: (err) => console.error(`[registry error] ${err.message}`),
    });

    subscribe(devTopic, {
      onEvent: handleRaw,
      onError: (err) => console.error(`[device error] ${err.message}`),
    });

    await new Promise(() => {});
  });

program
  .command("events")
  .description("Print event log as JSON")
  .action(() => {
    requireConfig();
    const state = loadState();

    if (state.eventLog.length === 0) {
      console.log("No events logged.");
      return;
    }

    console.log(JSON.stringify(state.eventLog, null, 2));
  });

program
  .command("export-state")
  .description("Export full local state as JSON")
  .action(() => {
    requireConfig();
    const state = loadState();

    const exported = {
      devices: [...state.devices.entries()].map(([, v]) => v),
      messages: [...state.messages.entries()].map(([, v]) => v),
      eventLog: state.eventLog,
    };

    console.log(JSON.stringify(exported, null, 2));
  });

program.parse();
