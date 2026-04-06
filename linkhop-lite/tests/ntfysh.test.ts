import { describe, it, expect } from "vitest";
import { publish } from "../src/transport/ntfy.js";
import { createEmptyState, getDevices, getInbox, getPending } from "../src/engine/state.js";
import { processEvent } from "../src/engine/reducer.js";
import { actionSend } from "../src/engine/actions.js";
import { validateEvent } from "../src/protocol/validate.js";
import { createDeviceAnnounce } from "../src/protocol/events.js";
import { deviceTopic, registryTopic } from "../src/protocol/topics.js";
import type { AnyProtocolEvent, DeviceConfig } from "../src/protocol/types.js";

const NTFY_SH = "https://ntfy.sh";

/** Generate a unique network ID per test run to avoid collisions on the public server */
const RUN_ID = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function makeConfig(id: string, name: string): DeviceConfig {
  return {
    device_id: id,
    device_name: name,
    network_id: `net_${RUN_ID}`,
    env: "test",
  };
}

/** Collect N events from an ntfy topic via NDJSON streaming */
function collectEvents(
  topic: string,
  count: number,
  timeoutMs = 15000,
): Promise<AnyProtocolEvent[]> {
  return new Promise((resolve, reject) => {
    const events: AnyProtocolEvent[] = [];
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      resolve(events);
    }, timeoutMs);

    const url = `${NTFY_SH}/${topic}/json?poll=0`;

    (async () => {
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/x-ndjson" },
        });

        if (!res.ok || !res.body) {
          clearTimeout(timer);
          reject(new Error(`subscribe failed: ${res.status}`));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const ntfyMsg = JSON.parse(line);
              if (ntfyMsg.event === "message" && ntfyMsg.message) {
                try {
                  events.push(JSON.parse(ntfyMsg.message));
                } catch {
                  // not JSON message body
                }
              }
            } catch {
              // not JSON
            }
          }

          if (events.length >= count) {
            clearTimeout(timer);
            controller.abort();
            resolve(events);
            return;
          }
        }
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          clearTimeout(timer);
          reject(err);
        }
      }
    })();
  });
}

/** Check if ntfy.sh is reachable */
async function ntfyShReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${NTFY_SH}/v1/health`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as { healthy: boolean };
    return body.healthy === true;
  } catch {
    return false;
  }
}

const SKIP = !(await ntfyShReachable());

describe.skipIf(SKIP)("integration: ntfy.sh public server", { timeout: 30000 }, () => {
  it("publish and subscribe roundtrip", async () => {
    const topic = `linkhop-${RUN_ID}-roundtrip`;
    const config = makeConfig("dev_rt", "Roundtrip");
    const event = createDeviceAnnounce(config);

    const collected = collectEvents(topic, 1);
    await new Promise((r) => setTimeout(r, 500));

    await publish(topic, event, NTFY_SH);

    const events = await collected;
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe("device.announce");
    expect(events[0].from_device_id).toBe("dev_rt");
  });

  it("two-device discovery over ntfy.sh", async () => {
    const phoneConfig = makeConfig("dev_phone_sh", "Phone");
    const desktopConfig = makeConfig("dev_desktop_sh", "Desktop");
    const regTopic = registryTopic("test", `net_${RUN_ID}`);

    const collected = collectEvents(regTopic, 2);
    await new Promise((r) => setTimeout(r, 500));

    await publish(regTopic, createDeviceAnnounce(phoneConfig), NTFY_SH);
    await publish(regTopic, createDeviceAnnounce(desktopConfig), NTFY_SH);

    const events = await collected;
    expect(events.length).toBe(2);

    const phoneState = createEmptyState();
    for (const raw of events) {
      const result = validateEvent(raw, `net_${RUN_ID}`);
      if (result.valid) {
        processEvent(phoneState, result.event, phoneConfig);
      }
    }

    const devices = getDevices(phoneState);
    expect(devices.length).toBe(2);
    expect(devices.find((d) => d.device_id === "dev_desktop_sh")).toBeDefined();
  });

  it("full message send/receive/ack flow over ntfy.sh", async () => {
    const sender = makeConfig("dev_sender_sh", "Sender");
    const recipient = makeConfig("dev_recipient_sh", "Recipient");

    const senderState = createEmptyState();
    const recipientState = createEmptyState();

    const regTopic = registryTopic("test", `net_${RUN_ID}`);
    const senderDevTopic = deviceTopic("test", `net_${RUN_ID}`, sender.device_id);
    const recipientDevTopic = deviceTopic("test", `net_${RUN_ID}`, recipient.device_id);

    // Step 1: Both announce
    const regCollected = collectEvents(regTopic, 2);
    await new Promise((r) => setTimeout(r, 500));

    await publish(regTopic, createDeviceAnnounce(sender), NTFY_SH);
    await publish(regTopic, createDeviceAnnounce(recipient), NTFY_SH);

    const regEvents = await regCollected;
    for (const raw of regEvents) {
      const result = validateEvent(raw, `net_${RUN_ID}`);
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
    const msgCollected = collectEvents(recipientDevTopic, 1);
    await new Promise((r) => setTimeout(r, 500));

    if (sendEffect.type === "publish") {
      await publish(sendEffect.topic, sendEffect.event, NTFY_SH);
    }

    const msgEvents = await msgCollected;
    expect(msgEvents.length).toBe(1);

    // Step 4: Recipient processes
    const msgResult = validateEvent(msgEvents[0], `net_${RUN_ID}`);
    expect(msgResult.valid).toBe(true);
    if (!msgResult.valid) return;

    const { effects } = processEvent(recipientState, msgResult.event, recipient);
    expect(getInbox(recipientState, recipient.device_id)).toHaveLength(1);
    expect(getInbox(recipientState, recipient.device_id)[0].body.text).toBe("hello over ntfy.sh");

    const ackEffect = effects.find((e) => e.type === "publish");
    expect(ackEffect).toBeDefined();

    // Step 5: Publish ack, collect on sender topic
    const ackCollected = collectEvents(senderDevTopic, 1);
    await new Promise((r) => setTimeout(r, 500));

    if (ackEffect?.type === "publish") {
      await publish(ackEffect.topic, ackEffect.event, NTFY_SH);
    }

    const ackEvents = await ackCollected;
    expect(ackEvents.length).toBe(1);

    // Step 6: Sender processes ack
    const ackResult = validateEvent(ackEvents[0], `net_${RUN_ID}`);
    expect(ackResult.valid).toBe(true);
    if (!ackResult.valid) return;

    processEvent(senderState, ackResult.event, sender);
    expect(getPending(senderState, sender.device_id)).toHaveLength(0);
    expect(senderState.messages.get(msgId)!.state).toBe("received");
  });
});
