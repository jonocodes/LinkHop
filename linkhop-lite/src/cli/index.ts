#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig, loadState, saveConfig, saveState, type CLIConfig } from "./store.js";
import { generateDeviceId, generateNetworkId } from "../protocol/ids.js";
import { deriveNetworkId } from "../protocol/network.js";
import { deriveEncryptionKey, encryptBody, decryptBody } from "../protocol/crypto.js";
import { deviceTopicFromConfig, registryTopicFromConfig } from "../protocol/topics.js";
import { actionAnnounce, actionLeave, actionSend } from "../engine/actions.js";
import { processEvent } from "../engine/reducer.js";
import { validateEvent } from "../protocol/validate.js";
import { getDevices, getInbox, getPending } from "../engine/state.js";
import { publish, subscribe } from "../transport/ntfy.js";
import { runFixture, type Fixture } from "../engine/fixtures.js";
import type { DeviceConfig, MessageBody, MessageRecord, TextBody } from "../protocol/types.js";
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

function requireConfig(): CLIConfig {
  const config = loadConfig();
  if (!config) {
    console.error("Not initialized. Run: linkhop-lite init");
    process.exit(1);
  }
  return config;
}

function displayBody(body: MessageBody): string {
  if (body.kind === "text") return body.text;
  return "[encrypted message — cannot decrypt]";
}

async function tryDecryptBody(
  body: MessageBody,
  cliConfig: CLIConfig,
): Promise<MessageBody> {
  if (body.kind !== "encrypted") return body;
  if (!cliConfig.password) return body;
  const key = await deriveEncryptionKey(cliConfig.password);
  const plaintext = await decryptBody(key, body.ciphertext, body.iv);
  if (!plaintext) return body;
  try {
    const inner = JSON.parse(plaintext) as TextBody;
    if (inner.kind === "text" && typeof inner.text === "string") return inner;
  } catch { /* ignore */ }
  return body;
}

async function tryDecryptRecord(
  m: MessageRecord,
  cliConfig: CLIConfig,
): Promise<string> {
  const decrypted = await tryDecryptBody(m.body, cliConfig);
  return displayBody(decrypted);
}

const program = new Command()
  .name("linkhop-lite")
  .description("LinkHop Lite reference CLI")
  .version("0.1.0");

program
  .command("init")
  .description("Create device identity and network config")
  .option("-n, --name <name>", "device display name")
  .option("--network <id>", "network ID (overrides --password)")
  .option("-p, --password <password>", "shared password to derive network ID")
  .option("--env <env>", "environment", "test")
  .option("--encrypt", "enable encryption (requires --password)")
  .action(async (opts) => {
    const existing = loadConfig();
    if (existing) {
      console.log(`Already initialized as ${existing.device.device_name} (${existing.device.device_id})`);
      return;
    }

    let networkId: string;
    if (opts.network) {
      networkId = opts.network;
    } else if (opts.password) {
      networkId = await deriveNetworkId(opts.password);
    } else {
      networkId = generateNetworkId();
    }

    const device: DeviceConfig = {
      device_id: generateDeviceId(),
      device_name: opts.name ?? `device-${Date.now()}`,
      network_id: networkId,
      env: opts.env,
    };

    const encryptionEnabled = opts.encrypt && opts.password;

    const cliConfig: CLIConfig = {
      device,
      password: opts.password,
      encryption_enabled: encryptionEnabled || false,
    };

    saveConfig(cliConfig);
    console.log(`Initialized device:`);
    console.log(`  device_id:  ${device.device_id}`);
    console.log(`  name:       ${device.device_name}`);
    console.log(`  network_id: ${device.network_id}`);
    console.log(`  env:        ${device.env}`);
    console.log(`  encryption: ${encryptionEnabled ? "on" : "off"}`);
  });

program
  .command("whoami")
  .description("Print local device identity and topics")
  .action(() => {
    const { device, encryption_enabled, password } = requireConfig();
    console.log(`device_id:      ${device.device_id}`);
    console.log(`device_name:    ${device.device_name}`);
    console.log(`network_id:     ${device.network_id}`);
    console.log(`env:            ${device.env}`);
    console.log(`registry_topic: ${registryTopicFromConfig(device)}`);
    console.log(`device_topic:   ${deviceTopicFromConfig(device)}`);
    console.log(`encryption:     ${encryption_enabled ? "on" : "off"}${password ? " (key available)" : ""}`);
  });

program
  .command("announce")
  .description("Emit device.announce to the registry topic")
  .action(async () => {
    const cliConfig = requireConfig();
    const capabilities = cliConfig.password ? ["encryption"] : [];
    await executeEffect(actionAnnounce(cliConfig.device, capabilities));
  });

program
  .command("leave")
  .description("Emit device.leave to the registry topic")
  .action(async () => {
    const { device } = requireConfig();
    await executeEffect(actionLeave(device));
  });

program
  .command("devices")
  .description("Show locally known devices")
  .action(() => {
    const { device } = requireConfig();
    const state = loadState();
    const devices = getDevices(state);

    if (devices.length === 0) {
      console.log("No known devices.");
      return;
    }

    for (const d of devices) {
      const self = d.device_id === device.device_id ? " (self)" : "";
      const removed = d.is_removed ? " [removed]" : "";
      const e2e = d.capabilities?.includes("encryption") ? " [E2E]" : "";
      console.log(`  ${d.device_name} (${d.device_id})${self}${removed}${e2e}`);
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
    const cliConfig = requireConfig();
    const state = loadState();

    const target = state.devices.get(deviceId);
    if (!target) {
      console.error(`Unknown device: ${deviceId}. Run 'watch' to discover devices.`);
      process.exit(1);
    }

    const text = textParts.join(" ");
    let body: MessageBody;

    if (cliConfig.encryption_enabled && cliConfig.password) {
      const key = await deriveEncryptionKey(cliConfig.password);
      const inner: TextBody = { kind: "text", text };
      const { ciphertext, iv } = await encryptBody(key, JSON.stringify(inner));
      body = { kind: "encrypted", ciphertext, iv };
      console.log("  [encrypted]");
    } else {
      body = { kind: "text", text };
    }

    const effect = actionSend(state, cliConfig.device, deviceId, target.device_topic, body);

    await executeEffect(effect);
    saveState(state);
    console.log("Message sent and stored as pending.");
  });

program
  .command("inbox")
  .description("Show received messages")
  .action(async () => {
    const cliConfig = requireConfig();
    const state = loadState();
    const inbox = getInbox(state, cliConfig.device.device_id);

    if (inbox.length === 0) {
      console.log("Inbox is empty.");
      return;
    }

    for (const m of inbox) {
      const text = await tryDecryptRecord(m, cliConfig);
      console.log(`  [${m.msg_id}] from ${m.from_device_id} at ${m.created_at}`);
      console.log(`    ${text}`);
    }
  });

program
  .command("pending")
  .description("Show pending outbound messages")
  .action(async () => {
    const cliConfig = requireConfig();
    const state = loadState();
    const pending = getPending(state, cliConfig.device.device_id);

    if (pending.length === 0) {
      console.log("No pending messages.");
      return;
    }

    for (const m of pending) {
      const text = await tryDecryptRecord(m, cliConfig);
      console.log(`  [${m.msg_id}] to ${m.to_device_id} at ${m.created_at}`);
      console.log(`    ${text}`);
      console.log(`    attempt: ${m.last_attempt_id} at ${m.last_attempt_at}`);
    }
  });

program
  .command("watch")
  .description("Subscribe and display live events")
  .action(async () => {
    const cliConfig = requireConfig();
    const { device } = cliConfig;
    const state = loadState();

    const regTopic = registryTopicFromConfig(device);
    const devTopic = deviceTopicFromConfig(device);

    console.log(`Watching topics:`);
    console.log(`  registry: ${regTopic}`);
    console.log(`  device:   ${devTopic}`);
    console.log();

    async function handleRaw(raw: unknown): Promise<void> {
      const result = validateEvent(raw, device.network_id);
      if (!result.valid) {
        console.log(`  [ignored] ${result.reason}`);
        return;
      }

      // Decrypt incoming messages if possible
      if (result.event.type === "msg.send" && result.event.payload.body.kind === "encrypted") {
        const decrypted = await tryDecryptBody(result.event.payload.body, cliConfig);
        if (decrypted.kind === "text") {
          result.event.payload.body = decrypted;
        }
      }

      console.log(`  <- ${result.event.type} from ${result.event.from_device_id}`);
      if (result.event.type === "msg.send") {
        console.log(`     ${displayBody(result.event.payload.body)}`);
      }

      const { effects } = processEvent(state, result.event, device);
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
      onEvent: (raw) => { handleRaw(raw); },
      onError: (err) => console.error(`[registry error] ${err.message}`),
    });

    subscribe(devTopic, {
      onEvent: (raw) => { handleRaw(raw); },
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

program
  .command("replay")
  .description("Replay a fixture file through the engine")
  .argument("<file>", "path to fixture JSON file")
  .action(async (file: string) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const path = resolve(file);
    const fixture = JSON.parse(readFileSync(path, "utf-8")) as Fixture;
    const result = runFixture(fixture);

    console.log(`Fixture: ${fixture.name}`);
    if (fixture.description) console.log(`  ${fixture.description}`);
    console.log(`Steps:   ${fixture.steps.length}`);
    console.log(`Effects: ${result.effects.length}`);
    console.log();

    if (result.passed) {
      console.log("PASSED");
    } else {
      console.log("FAILED");
      for (const err of result.errors) {
        console.log(`  - ${err}`);
      }
      process.exit(1);
    }
  });

program.parse();
