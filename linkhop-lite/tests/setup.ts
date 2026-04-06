/**
 * Vitest setup: enable HTTP proxy support for fetch().
 *
 * Bun/Node's global fetch ignores HTTP_PROXY/HTTPS_PROXY env vars.
 * This configures undici's ProxyAgent as the global dispatcher so all
 * fetch() calls in tests route through the proxy when one is set.
 */
import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}
