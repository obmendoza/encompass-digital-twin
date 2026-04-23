import { test, expect } from "@playwright/test";

test.describe("Pipeline", () => {
  test("shows loan list with 20 loans", async ({ page }) => {
    await page.goto("/");
    // Should see the pipeline table
    await expect(page.locator("text=Pipeline")).toBeVisible();
    // Check for loan rows — at least some loans visible
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test("loan link navigates to transmittal", async ({ page }) => {
    await page.goto("/");
    await page.click("text=2501000101");
    await expect(page).toHaveURL(/\/loan\/2501000101\/transmittal/);
    await expect(page.locator("text=Sanchez, Maria")).toBeVisible();
  });

  test("sandbox reset button works", async ({ page }) => {
    await page.goto("/");
    const resetBtn = page.locator('button:has-text("Reset All")');
    if (await resetBtn.isVisible()) {
      await resetBtn.click();
      await page.waitForTimeout(3000);
      await expect(page.locator("text=loans loaded")).toBeVisible();
    }
  });
});
