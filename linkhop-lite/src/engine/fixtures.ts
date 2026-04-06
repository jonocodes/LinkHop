import type {
  AnyProtocolEvent,
  DeviceConfig,
  DeviceRecord,
  LocalState,
  MessageBody,
  MessageRecord,
} from "../protocol/types.js";
import { processEvent } from "./reducer.js";
import { actionAnnounce, actionLeave, actionSend } from "./actions.js";
import { createEmptyState } from "./state.js";
import type { Effect } from "./reducer.js";

// --- Fixture types ---

export interface Fixture {
  name: string;
  description?: string;
  device: DeviceConfig;
  initial_state?: {
    devices?: DeviceRecord[];
    messages?: MessageRecord[];
  };
  steps: FixtureStep[];
  expected: {
    devices?: ExpectedDevice[];
    messages?: ExpectedMessage[];
  };
}

export type FixtureStep =
  | { kind: "incoming_event"; event: AnyProtocolEvent }
  | { kind: "action_announce" }
  | { kind: "action_leave" }
  | { kind: "action_send"; to_device_id: string; to_device_topic: string; body: MessageBody };

export interface ExpectedDevice {
  device_id: string;
  device_name?: string;
  is_removed?: boolean;
}

export interface ExpectedMessage {
  msg_id: string;
  state?: "pending" | "received";
  from_device_id?: string;
  to_device_id?: string;
}

// --- Fixture runner ---

export interface FixtureResult {
  passed: boolean;
  errors: string[];
  state: LocalState;
  effects: Effect[];
}

export function runFixture(fixture: Fixture): FixtureResult {
  const state = createEmptyState();
  const errors: string[] = [];
  const allEffects: Effect[] = [];

  // Load initial state
  if (fixture.initial_state?.devices) {
    for (const d of fixture.initial_state.devices) {
      state.devices.set(d.device_id, { ...d });
    }
  }
  if (fixture.initial_state?.messages) {
    for (const m of fixture.initial_state.messages) {
      state.messages.set(m.msg_id, { ...m });
    }
  }

  // Execute steps
  for (const step of fixture.steps) {
    switch (step.kind) {
      case "incoming_event": {
        const { effects } = processEvent(state, step.event, fixture.device);
        allEffects.push(...effects);
        break;
      }
      case "action_announce": {
        const effect = actionAnnounce(fixture.device);
        allEffects.push(effect);
        break;
      }
      case "action_leave": {
        const effect = actionLeave(fixture.device);
        allEffects.push(effect);
        break;
      }
      case "action_send": {
        const effect = actionSend(state, fixture.device, step.to_device_id, step.to_device_topic, step.body);
        allEffects.push(effect);
        break;
      }
    }
  }

  // Check expected devices
  if (fixture.expected.devices) {
    for (const exp of fixture.expected.devices) {
      const actual = state.devices.get(exp.device_id);
      if (!actual) {
        errors.push(`expected device ${exp.device_id} not found`);
        continue;
      }
      if (exp.device_name !== undefined && actual.device_name !== exp.device_name) {
        errors.push(`device ${exp.device_id}: expected name "${exp.device_name}", got "${actual.device_name}"`);
      }
      if (exp.is_removed !== undefined && actual.is_removed !== exp.is_removed) {
        errors.push(`device ${exp.device_id}: expected is_removed=${exp.is_removed}, got ${actual.is_removed}`);
      }
    }
  }

  // Check expected messages
  if (fixture.expected.messages) {
    for (const exp of fixture.expected.messages) {
      let actual: MessageRecord | undefined;

      if (exp.msg_id === "*") {
        // Wildcard: match the first message that fits the other criteria
        actual = [...state.messages.values()].find((m) => {
          if (exp.state !== undefined && m.state !== exp.state) return false;
          if (exp.from_device_id !== undefined && m.from_device_id !== exp.from_device_id) return false;
          if (exp.to_device_id !== undefined && m.to_device_id !== exp.to_device_id) return false;
          return true;
        });
        if (!actual) {
          errors.push(`expected a message matching wildcard, none found`);
          continue;
        }
      } else {
        actual = state.messages.get(exp.msg_id);
        if (!actual) {
          errors.push(`expected message ${exp.msg_id} not found`);
          continue;
        }
      }
      if (exp.state !== undefined && actual.state !== exp.state) {
        errors.push(`message ${exp.msg_id}: expected state="${exp.state}", got "${actual.state}"`);
      }
      if (exp.from_device_id !== undefined && actual.from_device_id !== exp.from_device_id) {
        errors.push(`message ${exp.msg_id}: expected from="${exp.from_device_id}", got "${actual.from_device_id}"`);
      }
      if (exp.to_device_id !== undefined && actual.to_device_id !== exp.to_device_id) {
        errors.push(`message ${exp.msg_id}: expected to="${exp.to_device_id}", got "${actual.to_device_id}"`);
      }
    }
  }

  return { passed: errors.length === 0, errors, state, effects: allEffects };
}
