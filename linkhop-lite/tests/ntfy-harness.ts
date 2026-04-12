import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";

const NTFY_BINARY = resolve(import.meta.dirname!, "..", "ntfy");
const DEFAULT_PORT = 4076;

function getTestConfig(port: number) {
  const configDir = resolve(tmpdir(), `ntfy-test-${port}`);
  mkdirSync(`${configDir}/cache`, { recursive: true });
  mkdirSync(`${configDir}/attachments`, { recursive: true });
  const configPath = resolve(configDir, "server.yml");
  writeFileSync(configPath, `
base-url: "http://localhost:${port}"
listen-http: ":${port}"
cache-file: "${configDir}/cache/ntfy.db"
attachment-cache-dir: "${configDir}/attachments"
no-log-dates: true
log-level: "WARN"
`.trim());
  return configPath;
}

export interface NtfyServer {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

export function ntfyAvailable(): boolean {
  return existsSync(NTFY_BINARY);
}

export async function startNtfy(port = DEFAULT_PORT): Promise<NtfyServer> {
  const configPath = getTestConfig(port);
  const proc: ChildProcess = spawn(NTFY_BINARY, [
    "serve",
    "-c", configPath,
  ], {
    stdio: "ignore",
  });

  const url = `http://localhost:${port}`;

  // Wait for server to be healthy
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/v1/health`);
      const body = await res.json() as { healthy: boolean };
      if (body.healthy) {
        return {
          url,
          port,
          stop: () => new Promise<void>((resolve) => {
            proc.on("exit", () => resolve());
            proc.kill("SIGTERM");
            // Force kill after 2s
            setTimeout(() => {
              proc.kill("SIGKILL");
              resolve();
            }, 2000);
          }),
        };
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  proc.kill("SIGKILL");
  throw new Error("ntfy server failed to start within 5s");
}
