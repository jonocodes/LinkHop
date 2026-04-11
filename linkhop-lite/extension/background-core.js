/**
 * Pure/testable logic extracted from the extension background page.
 * No chrome.* or EventSource dependencies.
 *
 * Works as both:
 * - A <script> tag in background.html (functions land on globalThis / window)
 * - An ES module import in vitest tests
 */

const BackgroundCore = {
  DEFAULT_APP_URL: "https://jonocodes.github.io/LinkHop/",

  registryTopic(cfg) {
    return `linkhop-${cfg.env}-${cfg.network_id}-registry`;
  },

  deviceTopic(cfg) {
    return `linkhop-${cfg.env}-${cfg.network_id}-device-${cfg.device_id}`;
  },

  /**
   * Parse an SSE message data string from ntfy into a protocol event.
   * Returns null if the data is not a valid protocol event.
   */
  parseSSEMessage(data) {
    try {
      const parsed = JSON.parse(data);
      // ntfy SSE wraps the payload: { event: "message", message: "<json string>" }
      if (parsed.event === "message" && typeof parsed.message === "string") {
        try { return JSON.parse(parsed.message); } catch { return null; }
      }
      // Direct protocol event
      if (parsed.type && parsed.event_id) return parsed;
    } catch { /* not JSON */ }
    return null;
  },

  /**
   * Check whether a parsed protocol event is a msg.send addressed to the given device.
   */
  isMessageForDevice(event, deviceId) {
    return (
      event &&
      event.type === "msg.send" &&
      event.payload?.to_device_id === deviceId
    );
  },

  /**
   * Build the URL match pattern from an app URL.
   */
  getAppUrlPattern(appUrl) {
    const base = appUrl.replace(/\/+$/, "");
    return base + "*";
  },

  /**
   * Extract extension config from a BrowserConfig object (as stored in the web app's IndexedDB).
   */
  extractConfig(browserConfig) {
    if (!browserConfig?.device) return null;
    return {
      device_id: browserConfig.device.device_id,
      device_name: browserConfig.device.device_name,
      network_id: browserConfig.device.network_id,
      env: browserConfig.device.env,
      ntfy_url: browserConfig.transport_url || browserConfig.ntfy_url,
    };
  },
};

// Make available everywhere:
// - <script> tag in background.html → globalThis.BackgroundCore
// - ESM import in vitest → named exports
if (typeof globalThis !== "undefined") {
  globalThis.BackgroundCore = BackgroundCore;
}
try { if (typeof module !== "undefined") module.exports = BackgroundCore; } catch {}
try { if (typeof exports !== "undefined") Object.assign(exports, BackgroundCore); } catch {}
