import { test, expect, setupDeviceInTab, publishToNtfy } from "./extension-fixtures.js";

test.describe("Extension config sync", () => {
  test("content script sends config to background on app load", async ({
    extContext,
    backgroundPage,
  }) => {
    // Tell the background page to use localhost app URL
    await backgroundPage.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ linkhop_lite_app_url: "http://localhost:5174/" }, () => resolve());
      });
    });

    const page = await extContext.newPage();
    await setupDeviceInTab(page, "ExtTestDevice", `ext-cfg-${Date.now()}`);

    // Wait for config to propagate to background
    const config = await backgroundPage.evaluate(() => {
      return new Promise<any>((resolve) => {
        const check = () => {
          chrome.storage.local.get("linkhop_lite_config", (result) => {
            if (result.linkhop_lite_config) resolve(result.linkhop_lite_config);
            else setTimeout(check, 200);
          });
        };
        check();
      });
    });

    expect(config.device_id).toBeTruthy();
    expect(config.device_name).toBe("ExtTestDevice");
    expect(config.network_id).toBeTruthy();
    expect(config.ntfy_url).toContain("localhost");
  });
});

test.describe("Tab-aware SSE", () => {
  test("starts watching when app tab closes, stops when it opens", async ({
    extContext,
    backgroundPage,
  }) => {
    await backgroundPage.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ linkhop_lite_app_url: "http://localhost:5174/" }, () => resolve());
      });
    });

    const page = await extContext.newPage();
    await setupDeviceInTab(page, "TabTestDevice", `ext-tab-${Date.now()}`);

    // Wait for config sync
    await backgroundPage.evaluate(() => {
      return new Promise<void>((resolve) => {
        const check = () => {
          chrome.storage.local.get("linkhop_lite_config", (result) => {
            if (result.linkhop_lite_config) resolve();
            else setTimeout(check, 200);
          });
        };
        check();
      });
    });

    // Tab is open — extension should NOT be watching (eventSources empty)
    const watchingWithTab = await backgroundPage.evaluate("eventSources.length");
    expect(watchingWithTab).toBe(0);

    // Close the app tab
    await page.close();
    // Give the background page time to detect and start SSE
    await new Promise((r) => setTimeout(r, 1000));

    const watchingWithoutTab = await backgroundPage.evaluate("eventSources.length");
    expect(watchingWithoutTab).toBe(2); // registry + device topic

    // Re-open a tab to the app
    const page2 = await extContext.newPage();
    await page2.goto("http://localhost:5174/");
    await page2.waitForSelector("#screen-main.active", { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Extension should go idle again
    const watchingAfterReopen = await backgroundPage.evaluate("eventSources.length");
    expect(watchingAfterReopen).toBe(0);
  });
});

test.describe("Message wakeup", () => {
  test("opens app tab when msg.send arrives while tab is closed", async ({
    extContext,
    backgroundPage,
  }) => {
    await backgroundPage.evaluate(() => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({ linkhop_lite_app_url: "http://localhost:5174/" }, () => resolve());
      });
    });

    const page = await extContext.newPage();
    const password = `ext-msg-${Date.now()}`;
    await setupDeviceInTab(page, "WakeupDevice", password);

    // Read the config from the background page to construct the topic and event
    const config = await backgroundPage.evaluate(() => {
      return new Promise<any>((resolve) => {
        const check = () => {
          chrome.storage.local.get("linkhop_lite_config", (result) => {
            if (result.linkhop_lite_config) resolve(result.linkhop_lite_config);
            else setTimeout(check, 200);
          });
        };
        check();
      });
    });

    const deviceTopic = `linkhop-${config.env}-${config.network_id}-device-${config.device_id}`;

    // Close the app tab so extension starts watching
    await page.close();
    await new Promise((r) => setTimeout(r, 1000));

    // Verify we're watching
    const watching = await backgroundPage.evaluate("eventSources.length");
    expect(watching).toBe(2);

    // Count tabs before
    const tabsBefore = extContext.pages().length;

    // Simulate a remote device sending a message to us via ntfy
    await publishToNtfy(deviceTopic, {
      type: "msg.send",
      timestamp: new Date().toISOString(),
      network_id: config.network_id,
      event_id: "evt_test_" + Date.now(),
      from_device_id: "dev_remote_sender",
      payload: {
        msg_id: "msg_test_" + Date.now(),
        attempt_id: 1,
        to_device_id: config.device_id,
        body: { kind: "text", text: "Hello from test!" },
      },
    });

    // Wait for the extension to open a new tab
    await expect.poll(
      () => extContext.pages().length,
      { timeout: 10_000, message: "Expected extension to open a new tab" },
    ).toBeGreaterThan(tabsBefore);

    // The new tab should be the app URL
    const pages = extContext.pages();
    const appPage = pages.find((p) => p.url().includes("localhost:5174"));
    expect(appPage).toBeTruthy();
  });
});
