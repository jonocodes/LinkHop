import { test, expect, setupDevice, NTFY_URL } from "./fixtures.js";

test.describe("Setup flow", () => {
  test("shows setup screen on first visit", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#screen-setup")).toBeVisible();
    await expect(page.locator("#screen-main")).not.toHaveClass(/active/);
  });

  test("requires name and password", async ({ page }) => {
    await page.goto("/");
    await page.click("#setup-btn");
    // Should still be on setup screen
    await expect(page.locator("#screen-setup")).toBeVisible();
    await expect(page.locator("#screen-main")).not.toHaveClass(/active/);
  });

  test("joins network and shows main screen", async ({ page }) => {
    await setupDevice(page, "TestDevice", "e2e-password");
    await expect(page.locator("#screen-main")).toHaveClass(/active/);
    await expect(page.locator("#status-text")).toContainText("TestDevice");
  });
});

test.describe("Device discovery", () => {
  test("two devices discover each other", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const password = `discovery-${Date.now()}`;

    await setupDevice(page1, "DeviceA", password);
    await setupDevice(page2, "DeviceB", password);

    // Both should be connected
    await expect(page1.locator("#status-dot")).toHaveClass(/connected/, { timeout: 10_000 });
    await expect(page2.locator("#status-dot")).toHaveClass(/connected/, { timeout: 10_000 });

    // DeviceA should see DeviceB in the devices list (and vice versa)
    await expect(page1.locator(".device-item")).toHaveCount(2, { timeout: 10_000 });
    await expect(page2.locator(".device-item")).toHaveCount(2, { timeout: 10_000 });

    await expect(page1.locator("#main-content")).toContainText("DeviceB");
    await expect(page2.locator("#main-content")).toContainText("DeviceA");

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe("Messaging", () => {
  test("send message and receive ack", async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const password = `messaging-${Date.now()}`;

    await setupDevice(page1, "Sender", password);
    await setupDevice(page2, "Receiver", password);

    // Wait for both connected and discovered
    await expect(page1.locator(".device-item")).toHaveCount(2, { timeout: 10_000 });
    await expect(page2.locator(".device-item")).toHaveCount(2, { timeout: 10_000 });

    // Switch Sender to inbox tab and send a message
    await page1.click('button[data-tab="inbox"]');
    await page1.waitForSelector("#send-form", { state: "visible" });

    // Select the Receiver device from dropdown
    await page1.selectOption("#send-target", { label: "Receiver" });
    await page1.fill("#send-text", "Hello from e2e!");
    await page1.click("#send-btn");

    // Receiver should see the message in inbox
    await page2.click('button[data-tab="inbox"]');
    await expect(page2.locator(".msg-item")).toContainText("Hello from e2e!", { timeout: 10_000 });
    await expect(page2.locator(".msg-item")).toContainText("From Sender");

    // Sender's pending tab should eventually clear (ack received)
    await page1.click('button[data-tab="pending"]');
    await expect(page1.locator(".empty-state")).toBeVisible({ timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe("Persistence", () => {
  test("state survives page reload", async ({ page }) => {
    const password = `persist-${Date.now()}`;
    await setupDevice(page, "Persistent", password);
    await expect(page.locator("#screen-main")).toHaveClass(/active/);

    // Reload the page
    await page.reload();

    // Should go straight to main screen (not setup)
    await expect(page.locator("#screen-main")).toHaveClass(/active/, { timeout: 10_000 });
    await expect(page.locator("#status-text")).toContainText("Persistent");
  });
});

test.describe("Leave network", () => {
  test("leave clears state and returns to setup", async ({ page }) => {
    const password = `leave-${Date.now()}`;
    await setupDevice(page, "Leaver", password);
    await expect(page.locator("#screen-main")).toHaveClass(/active/);

    // Accept the confirm dialog
    page.on("dialog", (dialog) => dialog.accept());
    await page.click("#leave-btn");

    // Should return to setup screen
    await expect(page.locator("#screen-setup")).toHaveClass(/active/, { timeout: 10_000 });
  });
});
