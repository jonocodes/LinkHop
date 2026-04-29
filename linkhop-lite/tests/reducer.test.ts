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
  resetIds,
} from "./helpers.js";

const localConfig = makeConfig();
const peerConfig = makePeerConfig();

describe("device.announce handling", () => {
  let state: LocalState;

  beforeEach(() => { resetIds(); state = createEmptyState(); });

  it("creates a device record from announce", () => {
    processEvent(state, makeAnnounce(peerConfig), localConfig);
    const dev = getDevice(state, peerConfig.device_id);
    expect(dev).toBeDefined();
    expect(dev!.device_name).toBe("Peer Device");
    expect(dev!.is_removed).toBe(false);
    expect(dev!.last_event_type).toBe("device.announce");
  });

  it("updates device record on re-announce with newer timestamp", () => {
    processEvent(state, makeAnnounce(peerConfig, "2026-04-04T18:00:00Z"), localConfig);
    processEvent(state, makeAnnounce({ ...peerConfig, device_name: "New Name" }, "2026-04-04T18:05:00Z"), localConfig);
    expect(getDevice(state, peerConfig.device_id)!.device_name).toBe("New Name");
  });

  it("ignores older re-announce", () => {
    processEvent(state, makeAnnounce(peerConfig, "2026-04-04T18:05:00Z"), localConfig);
    processEvent(state, makeAnnounce({ ...peerConfig, device_name: "Old Name" }, "2026-04-04T18:00:00Z"), localConfig);
    expect(getDevice(state, peerConfig.device_id)!.device_name).toBe("Peer Device");
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

  beforeEach(() => { resetIds(); state = createEmptyState(); });

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

  beforeEach(() => { resetIds(); state = createEmptyState(); processEvent(state, makeAnnounce(peerConfig), localConfig); });

  it("stores received message and signals newMessage", () => {
    const send = makeMsgSend(peerConfig, localConfig.device_id, { msgId: "msg_001" });
    const result = processEvent(state, send, localConfig);

    const inbox = getInbox(state, localConfig.device_id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].msg_id).toBe("msg_001");
    expect(inbox[0].state).toBe("received");
    expect(result.newMessage).toBe(true);
    expect(result.effects).toHaveLength(0); // no ntfy ACK anymore
  });

  it("ignores msg.send not addressed to us", () => {
    const result = processEvent(state, makeMsgSend(peerConfig, "dev_other"), localConfig);
    expect(getInbox(state, localConfig.device_id)).toHaveLength(0);
    expect(result.newMessage).toBe(false);
  });

  it("deduplicates a replayed msg.send (same msg_id)", () => {
    const send1 = makeMsgSend(peerConfig, localConfig.device_id, { msgId: "msg_dup", attemptId: 1 });
    const send2 = makeMsgSend(peerConfig, localConfig.device_id, { msgId: "msg_dup", attemptId: 1 });

    processEvent(state, send1, localConfig);
    const result2 = processEvent(state, send2, localConfig);

    expect(getInbox(state, localConfig.device_id)).toHaveLength(1);
    expect(result2.newMessage).toBe(false);
  });

  it("tracks higher attempt_id on retry but does not create duplicate", () => {
    const send1 = makeMsgSend(peerConfig, localConfig.device_id, { msgId: "msg_retry", attemptId: 1 });
    const send2 = makeMsgSend(peerConfig, localConfig.device_id, { msgId: "msg_retry", attemptId: 2 });

    processEvent(state, send1, localConfig);
    const result2 = processEvent(state, send2, localConfig);

    expect(getInbox(state, localConfig.device_id)).toHaveLength(1);
    expect(state.messages.get("msg_retry")!.last_attempt_id).toBe(2);
    expect(result2.newMessage).toBe(false);
  });
});

describe("actionSend", () => {
  it("creates a pending outbound message record", () => {
    const state = createEmptyState();
    processEvent(state, makeAnnounce(peerConfig), localConfig);
    actionSend(state, localConfig, peerConfig.device_id, peerConfig.device_topic ?? "topic_peer", {
      kind: "text",
      text: "outgoing",
    });
    expect(getPending(state, localConfig.device_id)).toHaveLength(1);
    expect(getPending(state, localConfig.device_id)[0].state).toBe("pending");
  });
});
