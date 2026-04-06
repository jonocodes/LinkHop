import { describe, it, expect, beforeEach } from "vitest";
import { createEmptyState, getDevice, getInbox, getPending } from "../src/engine/state.js";
import { processEvent } from "../src/engine/reducer.js";
import { actionSend } from "../src/engine/actions.js";
import type { LocalState } from "../src/protocol/types.js";
import {
  makeConfig,
  makePeerConfig,
  makeAnnounce,
  makeLeave,
  makeMsgSend,
  makeMsgReceived,
  resetIds,
} from "./helpers.js";
import { deviceTopic } from "../src/protocol/topics.js";

const localConfig = makeConfig();
const peerConfig = makePeerConfig();

function peerTopic(): string {
  return deviceTopic(peerConfig.env, peerConfig.network_id, peerConfig.device_id);
}

describe("device.announce handling", () => {
  let state: LocalState;

  beforeEach(() => {
    resetIds();
    state = createEmptyState();
  });

  it("creates a device record from announce", () => {
    const event = makeAnnounce(peerConfig);
    processEvent(state, event, localConfig);

    const dev = getDevice(state, peerConfig.device_id);
    expect(dev).toBeDefined();
    expect(dev!.device_name).toBe("Peer Device");
    expect(dev!.device_topic).toBe(peerTopic());
    expect(dev!.is_removed).toBe(false);
    expect(dev!.last_event_type).toBe("device.announce");
  });

  it("updates device record on re-announce", () => {
    processEvent(state, makeAnnounce(peerConfig, "2026-04-04T18:00:00Z"), localConfig);

    const renamed = makeAnnounce(
      { ...peerConfig, device_name: "New Name" },
      "2026-04-04T18:05:00Z",
    );
    processEvent(state, renamed, localConfig);

    const dev = getDevice(state, peerConfig.device_id);
    expect(dev!.device_name).toBe("New Name");
    expect(dev!.last_event_at).toBe("2026-04-04T18:05:00Z");
  });

  it("clears is_removed on re-announce after leave", () => {
    processEvent(state, makeAnnounce(peerConfig), localConfig);
    processEvent(state, makeLeave(peerConfig), localConfig);
    expect(getDevice(state, peerConfig.device_id)!.is_removed).toBe(true);

    processEvent(state, makeAnnounce(peerConfig, "2026-04-04T18:10:00Z"), localConfig);
    expect(getDevice(state, peerConfig.device_id)!.is_removed).toBe(false);
  });
});

describe("device.leave handling", () => {
  let state: LocalState;

  beforeEach(() => {
    resetIds();
    state = createEmptyState();
  });

  it("marks device as removed", () => {
    processEvent(state, makeAnnounce(peerConfig), localConfig);
    processEvent(state, makeLeave(peerConfig), localConfig);

    const dev = getDevice(state, peerConfig.device_id);
    expect(dev!.is_removed).toBe(true);
    expect(dev!.last_event_type).toBe("device.leave");
  });
});

describe("msg.send handling", () => {
  let state: LocalState;

  beforeEach(() => {
    resetIds();
    state = createEmptyState();
    // Peer must be known for ack to work
    processEvent(state, makeAnnounce(peerConfig), localConfig);
  });

  it("stores received message and emits msg.received", () => {
    const send = makeMsgSend(peerConfig, localConfig.device_id, { msgId: "msg_001" });
    const result = processEvent(state, send, localConfig);

    const inbox = getInbox(state, localConfig.device_id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].msg_id).toBe("msg_001");
    expect(inbox[0].state).toBe("received");
    expect(inbox[0].body.text).toBe("hello");

    // Should produce a publish effect for msg.received
    const publishes = result.effects.filter((e) => e.type === "publish");
    expect(publishes).toHaveLength(1);
    const ackEvent = (publishes[0] as { type: "publish"; event: { type: string } }).event;
    expect(ackEvent.type).toBe("msg.received");
  });

  it("ignores msg.send not addressed to us", () => {
    const send = makeMsgSend(peerConfig, "dev_other");
    const result = processEvent(state, send, localConfig);

    const inbox = getInbox(state, localConfig.device_id);
    expect(inbox).toHaveLength(0);
    expect(result.effects.some((e) => e.type === "log")).toBe(true);
  });

  it("deduplicates by msg_id and re-acks", () => {
    const send1 = makeMsgSend(peerConfig, localConfig.device_id, { msgId: "msg_dup", attemptId: 1 });
    const send2 = makeMsgSend(peerConfig, localConfig.device_id, {
      msgId: "msg_dup",
      attemptId: 2,
      ts: "2026-04-04T18:15:00Z",
    });

    processEvent(state, send1, localConfig);
    const result2 = processEvent(state, send2, localConfig);

    // Still only one inbox entry
    const inbox = getInbox(state, localConfig.device_id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].last_attempt_id).toBe(2);

    // But still emits ack
    const publishes = result2.effects.filter((e) => e.type === "publish");
    expect(publishes).toHaveLength(1);
  });
});

describe("msg.received handling", () => {
  let state: LocalState;

  beforeEach(() => {
    resetIds();
    state = createEmptyState();
    processEvent(state, makeAnnounce(peerConfig), localConfig);
  });

  it("clears pending state on ack", () => {
    // Send a message (creates pending record)
    actionSend(state, localConfig, peerConfig.device_id, peerTopic(), {
      kind: "text",
      text: "outgoing",
    });

    const pending = getPending(state, localConfig.device_id);
    expect(pending).toHaveLength(1);
    const msgId = pending[0].msg_id;

    // Simulate receiving ack
    const ack = makeMsgReceived(peerConfig, msgId, localConfig.device_id);
    processEvent(state, ack, localConfig);

    expect(getPending(state, localConfig.device_id)).toHaveLength(0);
    const msg = state.messages.get(msgId)!;
    expect(msg.state).toBe("received");
    expect(msg.received_at).toBe(ack.timestamp);
  });

  it("ignores ack not addressed to us", () => {
    actionSend(state, localConfig, peerConfig.device_id, peerTopic(), {
      kind: "text",
      text: "outgoing",
    });

    const pending = getPending(state, localConfig.device_id);
    const msgId = pending[0].msg_id;

    const ack = makeMsgReceived(peerConfig, msgId, "dev_someone_else");
    processEvent(state, ack, localConfig);

    // Still pending
    expect(getPending(state, localConfig.device_id)).toHaveLength(1);
  });
});

describe("lost acknowledgement scenario", () => {
  let state: LocalState;

  beforeEach(() => {
    resetIds();
    state = createEmptyState();
    processEvent(state, makeAnnounce(peerConfig), localConfig);
  });

  it("sender stays pending until ack arrives", () => {
    // Sender sends
    actionSend(state, localConfig, peerConfig.device_id, peerTopic(), {
      kind: "text",
      text: "important message",
    });

    const msgId = getPending(state, localConfig.device_id)[0].msg_id;
    expect(getPending(state, localConfig.device_id)).toHaveLength(1);

    // Ack is lost... sender retries (not modeled here, but eventually ack arrives)
    const ack = makeMsgReceived(peerConfig, msgId, localConfig.device_id, "2026-04-04T19:00:00Z");
    processEvent(state, ack, localConfig);

    expect(getPending(state, localConfig.device_id)).toHaveLength(0);
  });
});

describe("event log", () => {
  it("records all incoming events", () => {
    const state = createEmptyState();
    processEvent(state, makeAnnounce(peerConfig), localConfig);
    processEvent(state, makeAnnounce(peerConfig, "2026-04-04T18:01:00Z"), localConfig);

    expect(state.eventLog).toHaveLength(2);
    expect(state.eventLog[0].direction).toBe("incoming");
    expect(state.eventLog[0].type).toBe("device.announce");
  });
});
