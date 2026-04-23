import { test, expect } from "@playwright/test";

test.describe("Workshop", () => {
  test("workshop page loads", async ({ page }) => {
    await page.goto("/workshop");
    await expect(page.locator("text=Scenario Workshop")).toBeVisible();
  });

  test("preset buttons are visible", async ({ page }) => {
    await page.goto("/workshop");
    await expect(page.locator('button:has-text("Random NQM")').first()).toBeVisible();
    await expect(page.locator('button:has-text("DSCR Edge")').first()).toBeVisible();
  });
});
