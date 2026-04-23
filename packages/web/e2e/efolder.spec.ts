import { test, expect } from "@playwright/test";

test.describe("eFolder", () => {
  test("efolder page loads", async ({ page }) => {
    await page.goto("/loan/2501000101/efolder");
    await expect(page.locator("text=eFolder")).toBeVisible();
  });

  test("add document button visible", async ({ page }) => {
    await page.goto("/loan/2501000101/efolder");
    await expect(page.locator('button:has-text("Add Document")').or(page.locator("text=+ Add Document"))).toBeVisible();
  });
});
