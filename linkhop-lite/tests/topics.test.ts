import { describe, it, expect } from "vitest";
import { registryTopic, deviceTopic, registryTopicFromConfig, deviceTopicFromConfig } from "../src/protocol/topics.js";
import { makeConfig } from "./helpers.js";

describe("topic naming", () => {
  it("generates registry topic", () => {
    expect(registryTopic("test", "net_f7k29m")).toBe("linkhop.test.net_f7k29m.registry");
  });

  it("generates device topic", () => {
    expect(deviceTopic("test", "net_f7k29m", "dev_phone_123")).toBe(
      "linkhop.test.net_f7k29m.device.dev_phone_123",
    );
  });

  it("generates topics from config", () => {
    const config = makeConfig({ network_id: "net_abc", device_id: "dev_x", env: "prod" });
    expect(registryTopicFromConfig(config)).toBe("linkhop.prod.net_abc.registry");
    expect(deviceTopicFromConfig(config)).toBe("linkhop.prod.net_abc.device.dev_x");
  });
});
