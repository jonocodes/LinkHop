import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runFixture, type Fixture } from "../src/engine/fixtures.js";

const FIXTURES_DIR = join(import.meta.dirname!, "..", "fixtures");

const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("fixture replay", () => {
  for (const file of fixtureFiles) {
    const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf-8")) as Fixture;

    it(`${fixture.name}: ${fixture.description ?? file}`, () => {
      const result = runFixture(fixture);
      if (!result.passed) {
        throw new Error(`Fixture failed:\n  ${result.errors.join("\n  ")}`);
      }
      expect(result.passed).toBe(true);
    });
  }
});

describe("fixture runner assertions catch failures", () => {
  it("detects missing expected device", () => {
    const fixture: Fixture = {
      name: "should-fail",
      device: { device_id: "dev_x", device_name: "X", network_id: "net_test", env: "test" },
      steps: [],
      expected: { devices: [{ device_id: "dev_nonexistent" }] },
    };
    const result = runFixture(fixture);
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("dev_nonexistent");
  });

  it("detects wrong message state", () => {
    const fixture: Fixture = {
      name: "wrong-state",
      device: { device_id: "dev_local", device_name: "L", network_id: "net_test", env: "test" },
      initial_state: {
        devices: [{
          device_id: "dev_peer",
          device_name: "P",
          device_topic: "linkhop-test-net_test-device-dev_peer",
          last_event_at: "2026-04-04T18:00:00Z",
          last_event_type: "device.announce",
          is_removed: false,
        }],
      },
      steps: [{
        kind: "incoming_event",
        event: {
          type: "msg.send",
          timestamp: "2026-04-04T18:10:00Z",
          network_id: "net_test",
          event_id: "evt_010",
          from_device_id: "dev_peer",
          payload: {
            msg_id: "msg_wrong",
            attempt_id: 1,
            to_device_id: "dev_local",
            body: { kind: "text", text: "hi" },
          },
        },
      }],
      expected: {
        messages: [{ msg_id: "msg_wrong", state: "pending" }],
      },
    };
    const result = runFixture(fixture);
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("state");
  });
});
