# Browser E2E (Playwright)

End-to-end tests for **linkhop-ts** using Node and `@playwright/test`. They drive a real Chromium session against a **locally spawned** Deno server: login → register device → service worker → **Test Push** → assert the test message appears in the inbox list.

The in-repo HTTP tests (`deno task test` under `tests/`) exercise the Hono app in-process only. This folder is the **full UI + service worker + IndexedDB** path.

---

## Prerequisites

- **Node.js** (18+) and **npm**
- **Deno** on your `PATH` (the server under test is started with `deno run -A src/main.ts` from the parent `linkhop-ts` directory)
- Chromium installed for Playwright (see below)

If `deno` is missing, the Playwright spec is **skipped** (exit 0) so CI can still run without Deno.

---

## One-time setup

From this directory (`linkhop-ts/playwright/`):

```bash
npm install
npx playwright install chromium
```

---

## Run tests

```bash
cd linkhop-ts/playwright
npm test
```

Useful variants:

```bash
# Interactive UI mode
npm run test:ui

# Headed browser (see the browser window)
npx playwright test --headed

# Debug step-through
npx playwright test --debug
```

---

## What the test does

1. Spawns linkhop-ts on **`http://127.0.0.1:8011`** with a temporary SQLite DB and fixed test env (VAPID keys, session secret, `ALLOW_SELF_SEND=true`).
2. Password is **`testpass123`**; the hash is generated in Node with **bcryptjs** (same as the app’s bcrypt verification).
3. Opens `/login`, then `/account/activate-device`, then `/account/inbox`.
4. Waits for a real **`navigator.serviceWorker.controller`**.
5. Registers a **dummy** push subscription via `POST /api/push/subscriptions` with a fake endpoint so `POST /api/push/test` is allowed (delivery to that URL may fail; the API still returns the echoed message for the SPA to ingest).
6. Clicks **Test Push** (`#push-test`) and expects **“LinkHop push test”** in `#message-list`.

---

## Port and isolation

- The test server uses port **8011** to avoid colliding with a typical dev server on **8000**.
- Do not run another linkhop-ts instance on **8011** while the test runs.

---

## Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `1 skipped` | `deno` not on `PATH` |
| Timeout waiting for service worker | First load can be slow; re-run or increase timeouts in `playwright.config.ts` / the spec |
| Test Push / inbox assertion fails | Chromium/Playwright in CI may need `npx playwright install-deps` on Linux |

Artifacts on failure: `trace: 'on-first-retry'` is enabled in `playwright.config.ts`; check `test-results/` and Playwright’s HTML report.

---

## See also

- `../LINKHOP_TS.md` — overview of the Deno app and Web Push behavior
- `../tests/e2e.test.ts` — in-process API and session tests (no browser)
