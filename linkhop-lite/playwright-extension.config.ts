import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "extension.test.ts",
  timeout: 30_000,
  retries: 0,
  // Extension tests use Chromium (extensions not supported in Firefox with Playwright)
  // and launch their own persistent context, so no project-level browser config needed.
  webServer: [
    {
      command: "bun run dev --port 5174",
      port: 5174,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
