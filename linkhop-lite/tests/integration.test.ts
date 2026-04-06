import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ntfyAvailable, startNtfy, type NtfyServer } from "./ntfy-harness.js";
import { publish } from "../src/transport/ntfy.js";
import { createEmptyState, getDevices, getInbox, getPending } from "../src/engine/state.js";
import { processEvent } from "../src/engine/reducer.js";
import { actionAnnounce, actionSend } from "../src/engine/actions.js";
import { validateEvent } from "../src/protocol/validate.js";
import { deviceTopic, registryTopic } from "../src/protocol/topics.js";
import { createDeviceAnnounce } from "../src/protocol/events.js";
import type { AnyProtocolEvent, DeviceConfig } from "../src/protocol/types.js";

const SKIP = !ntfyAvailable();

function makeConfig(id: string, name: string): DeviceConfig {
  return {
    device_id: id,
    device_name: name,
    network_id: "net_inttest",
    env: "test",
  };
}

/** Collect N events from an ntfy topic via NDJSON streaming */
function collectEvents(
  baseUrl: string,
  topic: string,
  count: number,
  timeoutMs = 5000,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      resolve(events);
    }, timeoutMs);

    const url = `${baseUrl}/${topic}/json?poll=0`;

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

describe.skipIf(SKIP)("integration: ntfy transport", () => {
  let server: NtfyServer;

  beforeAll(async () => {
    server = await startNtfy(18081);
  });

  afterAll(async () => {
    await server?.stop();
  });

  it("publish and subscribe roundtrip", async () => {
    const topic = "linkhop-test-net_inttest-roundtrip";
    const event = createDeviceAnnounce(makeConfig("dev_rt", "Roundtrip"));

    // Start collecting before publish
    const collected = collectEvents(server.url, topic, 1);
    await new Promise((r) => setTimeout(r, 200));

    await publish(topic, event, server.url);

    const events = await collected;
    expect(events.length).toBeGreaterThanOrEqual(1);
    const received = events[0] as AnyProtocolEvent;
    expect(received.type).toBe("device.announce");
    expect(received.from_device_id).toBe("dev_rt");
  });

  it("two-device discovery over real ntfy", async () => {
    const phoneConfig = makeConfig("dev_phone_int", "Phone");
    const desktopConfig = makeConfig("dev_desktop_int", "Desktop");

    const regTopic = registryTopic("test", "net_inttest");

    const collected = collectEvents(server.url, regTopic, 2);
    await new Promise((r) => setTimeout(r, 200));

    const phoneAnnounce = createDeviceAnnounce(phoneConfig);
    const desktopAnnounce = createDeviceAnnounce(desktopConfig);
    await publish(regTopic, phoneAnnounce, server.url);
    await publish(regTopic, desktopAnnounce, server.url);

    const events = await collected;
    expect(events.length).toBe(2);

    const phoneState = createEmptyState();
    for (const raw of events) {
      const result = validateEvent(raw, "net_inttest");
      if (result.valid) {
        processEvent(phoneState, result.event, phoneConfig);
      }
    }

    const devices = getDevices(phoneState);
    expect(devices.length).toBe(2);
    expect(devices.find((d) => d.device_id === "dev_desktop_int")).toBeDefined();
  });

  it("full message send/receive/ack flow over real ntfy", async () => {
    const sender = makeConfig("dev_sender_int", "Sender");
    const recipient = makeConfig("dev_recipient_int", "Recipient");

    const senderState = createEmptyState();
    const recipientState = createEmptyState();

    const regTopic = registryTopic("test", "net_inttest");
    const senderDevTopic = deviceTopic("test", "net_inttest", sender.device_id);
    const recipientDevTopic = deviceTopic("test", "net_inttest", recipient.device_id);

    // Step 1: Both announce
    const senderAnnounce = createDeviceAnnounce(sender);
    const recipientAnnounce = createDeviceAnnounce(recipient);

    const regCollected = collectEvents(server.url, regTopic, 2);
    await new Promise((r) => setTimeout(r, 200));
    await publish(regTopic, senderAnnounce, server.url);
    await publish(regTopic, recipientAnnounce, server.url);
    const regEvents = await regCollected;

    for (const raw of regEvents) {
      const result = validateEvent(raw, "net_inttest");
      if (result.valid) {
        processEvent(senderState, result.event, sender);
        processEvent(recipientState, result.event, recipient);
      }
    }

    expect(getDevices(senderState).length).toBe(2);

    // Step 2: Sender sends a message
    const sendEffect = actionSend(senderState, sender, recipient.device_id, recipientDevTopic, {
      kind: "text",
      text: "hello over ntfy",
    });
    expect(sendEffect.type).toBe("publish");
    expect(getPending(senderState, sender.device_id)).toHaveLength(1);
    const msgId = getPending(senderState, sender.device_id)[0].msg_id;

    // Step 3: Publish message, collect on recipient topic
    const msgCollected = collectEvents(server.url, recipientDevTopic, 1);
    await new Promise((r) => setTimeout(r, 200));
    if (sendEffect.type === "publish") {
      await publish(sendEffect.topic, sendEffect.event, server.url);
    }

    const msgEvents = await msgCollected;
    expect(msgEvents.length).toBe(1);

    // Step 4: Recipient processes
    const msgResult = validateEvent(msgEvents[0], "net_inttest");
    expect(msgResult.valid).toBe(true);
    if (!msgResult.valid) return;

    const { effects } = processEvent(recipientState, msgResult.event, recipient);
    expect(getInbox(recipientState, recipient.device_id)).toHaveLength(1);
    expect(getInbox(recipientState, recipient.device_id)[0].body.text).toBe("hello over ntfy");

    const ackEffect = effects.find((e) => e.type === "publish");
    expect(ackEffect).toBeDefined();

    // Step 5: Publish ack, collect on sender topic
    const ackCollected = collectEvents(server.url, senderDevTopic, 1);
    await new Promise((r) => setTimeout(r, 200));
    if (ackEffect?.type === "publish") {
      await publish(ackEffect.topic, ackEffect.event, server.url);
    }

    const ackEvents = await ackCollected;
    expect(ackEvents.length).toBe(1);

    // Step 6: Sender processes ack
    const ackResult = validateEvent(ackEvents[0], "net_inttest");
    expect(ackResult.valid).toBe(true);
    if (!ackResult.valid) return;

    processEvent(senderState, ackResult.event, sender);

    expect(getPending(senderState, sender.device_id)).toHaveLength(0);
    expect(senderState.messages.get(msgId)!.state).toBe("received");
  });
});
