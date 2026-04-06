/**
 * Proxy-aware HTTP helpers for tests.
 *
 * Bun's native fetch ignores HTTP_PROXY/HTTPS_PROXY environment variables.
 * These helpers use node:http/node:https which respect proxy settings,
 * allowing tests to work in proxied environments (e.g. CI containers).
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import type { AnyProtocolEvent } from "../src/protocol/types.js";

function getProxy(): URL | null {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxyUrl) return null;
  return new URL(proxyUrl);
}

function makeProxyAuth(proxy: URL): string | undefined {
  if (!proxy.username) return undefined;
  return "Basic " + Buffer.from(`${proxy.username}:${decodeURIComponent(proxy.password)}`).toString("base64");
}

/** GET request that works through HTTP_PROXY */
export function httpGet(targetUrl: string, timeoutMs = 10000): Promise<string> {
  const target = new URL(targetUrl);
  const proxy = getProxy();

  if (!proxy || target.protocol === "http:") {
    // Direct request (no proxy or plain HTTP)
    const mod = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.get(targetUrl, { timeout: timeoutMs }, (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    });
  }

  // HTTPS through HTTP CONNECT proxy
  return new Promise((resolve, reject) => {
    const auth = makeProxyAuth(proxy);
    const connectReq = http.request({
      host: proxy.hostname,
      port: Number(proxy.port),
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers: {
        Host: `${target.hostname}:${target.port || 443}`,
        ...(auth ? { "Proxy-Authorization": auth } : {}),
      },
      timeout: timeoutMs,
    });

    connectReq.on("connect", (_res, socket) => {
      const req = https.get(
        {
          hostname: target.hostname,
          path: target.pathname + target.search,
          socket,
          agent: false,
          timeout: timeoutMs,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => resolve(data));
        },
      );
      req.on("error", reject);
    });

    connectReq.on("error", reject);
    connectReq.on("timeout", () => {
      connectReq.destroy();
      reject(new Error("timeout"));
    });
    connectReq.end();
  });
}

/** POST request that works through HTTP_PROXY */
export function httpPost(targetUrl: string, body: string, timeoutMs = 10000): Promise<string> {
  const target = new URL(targetUrl);
  const proxy = getProxy();

  if (!proxy || target.protocol === "http:") {
    const mod = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request(targetUrl, { method: "POST", timeout: timeoutMs }, (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout"));
      });
      req.write(body);
      req.end();
    });
  }

  return new Promise((resolve, reject) => {
    const auth = makeProxyAuth(proxy);
    const connectReq = http.request({
      host: proxy.hostname,
      port: Number(proxy.port),
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers: {
        Host: `${target.hostname}:${target.port || 443}`,
        ...(auth ? { "Proxy-Authorization": auth } : {}),
      },
      timeout: timeoutMs,
    });

    connectReq.on("connect", (_res, socket) => {
      const req = https.request(
        {
          hostname: target.hostname,
          path: target.pathname + target.search,
          method: "POST",
          socket,
          agent: false,
          timeout: timeoutMs,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => resolve(data));
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    connectReq.on("error", reject);
    connectReq.on("timeout", () => {
      connectReq.destroy();
      reject(new Error("timeout"));
    });
    connectReq.end();
  });
}

/** Publish a protocol event to an ntfy topic (proxy-aware) */
export async function publishViaProxy(
  topic: string,
  event: AnyProtocolEvent,
  baseUrl: string,
): Promise<void> {
  await httpPost(`${baseUrl}/${topic}`, JSON.stringify(event));
}

/** Subscribe to an ntfy topic and collect events via streaming (proxy-aware).
 *  Falls back to polling since CONNECT-based streaming is complex. */
export function collectEventsViaProxy(
  baseUrl: string,
  topic: string,
  count: number,
  timeoutMs = 15000,
): Promise<AnyProtocolEvent[]> {
  const events: AnyProtocolEvent[] = [];

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    const poll = async () => {
      while (Date.now() < deadline && events.length < count) {
        try {
          const since = "2m";
          const raw = await httpGet(`${baseUrl}/${topic}/json?poll=1&since=${since}`, 5000);
          for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            try {
              const ntfyMsg = JSON.parse(line);
              if (ntfyMsg.event === "message" && ntfyMsg.message) {
                try {
                  const evt = JSON.parse(ntfyMsg.message) as AnyProtocolEvent;
                  // Deduplicate by event_id
                  if (!events.some((e) => e.event_id === evt.event_id)) {
                    events.push(evt);
                  }
                } catch {
                  /* not JSON body */
                }
              }
            } catch {
              /* not JSON line */
            }
          }
        } catch {
          /* poll failed, retry */
        }
        if (events.length >= count) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      resolve(events);
    };

    poll();
  });
}
