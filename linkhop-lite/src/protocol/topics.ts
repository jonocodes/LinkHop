import type { DeviceConfig } from "./types.js";

export function registryTopic(env: string, networkId: string): string {
  return `linkhop-${env}-${networkId}-registry`;
}

export function deviceTopic(env: string, networkId: string, deviceId: string): string {
  return `linkhop-${env}-${networkId}-device-${deviceId}`;
}

export function registryTopicFromConfig(config: DeviceConfig): string {
  return registryTopic(config.env, config.network_id);
}

export function deviceTopicFromConfig(config: DeviceConfig): string {
  return deviceTopic(config.env, config.network_id, config.device_id);
}
