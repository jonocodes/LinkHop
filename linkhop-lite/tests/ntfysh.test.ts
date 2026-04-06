import { describe, it, expect, beforeAll } from "vitest";
import { createEmptyState, getDevices, getInbox, getPending } from "../src/engine/state.js";
import { processEvent } from "../src/engine/reducer.js";
import { actionSend } from "../src/engine/actions.js";
import { validateEvent } from "../src/protocol/validate.js";
import { createDeviceAnnounce } from "../src/protocol/events.js";
import { deviceTopic, registryTopic } from "../src/protocol/topics.js";
import type { DeviceConfig } from "../src/protocol/types.js";
import { httpGet, publishViaProxy, collectEventsViaProxy } from "./proxy-fetch.js";

const NTFY_SH = "https://ntfy.sh";

/** Generate a short unique ID. Must stay short — ntfy.sh has a 64-char topic name limit. */
function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function makeConfig(id: string, name: string, networkId: string): DeviceConfig {
  return {
    device_id: id,
    device_name: name,
    network_id: networkId,
    env: "test",
  };
}

/** Check if ntfy.sh is reachable (proxy-aware) */
async function ntfyShReachable(): Promise<boolean> {
  try {
    const raw = await httpGet(`${NTFY_SH}/v1/health`, 5000);
    const body = JSON.parse(raw) as { healthy: boolean };
    return body.healthy === true;
  } catch {
    return false;
  }
}

describe("integration: ntfy.sh public server", { timeout: 30000 }, () => {
  let reachable = false;

  beforeAll(async () => {
    reachable = await ntfyShReachable();
    if (!reachable) console.log("Skipping ntfy.sh tests — server not reachable");
  });

  it("publish and subscribe roundtrip", async (ctx) => {
    if (!reachable) return ctx.skip();

    const netId = `n${uniqueId()}`;
    const topic = `lh-${netId}-rt`;
    const config = makeConfig("dev_rt", "Roundtrip", netId);
    const event = createDeviceAnnounce(config);

    await publishViaProxy(topic, event, NTFY_SH);
    await new Promise((r) => setTimeout(r, 500));

    const events = await collectEventsViaProxy(NTFY_SH, topic, 1);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe("device.announce");
    expect(events[0].from_device_id).toBe("dev_rt");
  });

  it("two-device discovery over ntfy.sh", async (ctx) => {
    if (!reachable) return ctx.skip();

    const netId = `n${uniqueId()}`;
    const phoneConfig = makeConfig("dev_ph", "Phone", netId);
    const desktopConfig = makeConfig("dev_dk", "Desktop", netId);
    const regTopic = registryTopic("test", netId);

    await publishViaProxy(regTopic, createDeviceAnnounce(phoneConfig), NTFY_SH);
    await publishViaProxy(regTopic, createDeviceAnnounce(desktopConfig), NTFY_SH);
    await new Promise((r) => setTimeout(r, 500));

    const events = await collectEventsViaProxy(NTFY_SH, regTopic, 2);
    expect(events.length).toBe(2);

    const phoneState = createEmptyState();
    for (const raw of events) {
      const result = validateEvent(raw, netId);
      if (result.valid) {
        processEvent(phoneState, result.event, phoneConfig);
      }
    }

    const devices = getDevices(phoneState);
    expect(devices.length).toBe(2);
    expect(devices.find((d) => d.device_id === "dev_dk")).toBeDefined();
  });

  it("full message send/receive/ack flow over ntfy.sh", async (ctx) => {
    if (!reachable) return ctx.skip();

    const netId = `n${uniqueId()}`;
    const sender = makeConfig("dev_s", "Sender", netId);
    const recipient = makeConfig("dev_r", "Recipient", netId);

    const senderState = createEmptyState();
    const recipientState = createEmptyState();

    const regTopic = registryTopic("test", netId);
    const senderDevTopic = deviceTopic("test", netId, sender.device_id);
    const recipientDevTopic = deviceTopic("test", netId, recipient.device_id);

    // Step 1: Both announce
    await publishViaProxy(regTopic, createDeviceAnnounce(sender), NTFY_SH);
    await publishViaProxy(regTopic, createDeviceAnnounce(recipient), NTFY_SH);
    await new Promise((r) => setTimeout(r, 500));

    const regEvents = await collectEventsViaProxy(NTFY_SH, regTopic, 2);
    for (const raw of regEvents) {
      const result = validateEvent(raw, netId);
      if (result.valid) {
        processEvent(senderState, result.event, sender);
        processEvent(recipientState, result.event, recipient);
      }
    }
    expect(getDevices(senderState).length).toBe(2);

    // Step 2: Sender sends a message
    const sendEffect = actionSend(senderState, sender, recipient.device_id, recipientDevTopic, {
      kind: "text",
      text: "hello over ntfy.sh",
    });
    expect(sendEffect.type).toBe("publish");
    expect(getPending(senderState, sender.device_id)).toHaveLength(1);
    const msgId = getPending(senderState, sender.device_id)[0].msg_id;

    // Step 3: Publish message, collect on recipient topic
    if (sendEffect.type === "publish") {
      await publishViaProxy(sendEffect.topic, sendEffect.event, NTFY_SH);
    }
    await new Promise((r) => setTimeout(r, 1000));

    const msgEvents = await collectEventsViaProxy(NTFY_SH, recipientDevTopic, 1);
    expect(msgEvents.length).toBe(1);

    // Step 4: Recipient processes
    const msgResult = validateEvent(msgEvents[0], netId);
    expect(msgResult.valid).toBe(true);
    if (!msgResult.valid) return;

    const { effects } = processEvent(recipientState, msgResult.event, recipient);
    expect(getInbox(recipientState, recipient.device_id)).toHaveLength(1);
    expect(getInbox(recipientState, recipient.device_id)[0].body.text).toBe("hello over ntfy.sh");

    const ackEffect = effects.find((e) => e.type === "publish");
    expect(ackEffect).toBeDefined();

    // Step 5: Publish ack, collect on sender topic
    if (ackEffect?.type === "publish") {
      await publishViaProxy(ackEffect.topic, ackEffect.event, NTFY_SH);
    }
    await new Promise((r) => setTimeout(r, 1000));

    const ackEvents = await collectEventsViaProxy(NTFY_SH, senderDevTopic, 1);
    expect(ackEvents.length).toBe(1);

    // Step 6: Sender processes ack
    const ackResult = validateEvent(ackEvents[0], netId);
    expect(ackResult.valid).toBe(true);
    if (!ackResult.valid) return;

    processEvent(senderState, ackResult.event, sender);
    expect(getPending(senderState, sender.device_id)).toHaveLength(0);
    expect(senderState.messages.get(msgId)!.state).toBe("received");
  });
});
