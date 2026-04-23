import { test, expect } from "@playwright/test";

test.describe("Metrics", () => {
  test("metrics page loads with stats", async ({ page }) => {
    await page.goto("/metrics");
    await expect(page.locator("text=Platform Metrics").or(page.locator("text=Total Loans"))).toBeVisible({ timeout: 10_000 });
  });
});
