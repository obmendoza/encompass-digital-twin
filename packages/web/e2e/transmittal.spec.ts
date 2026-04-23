import { test, expect } from "@playwright/test";

test.describe("Transmittal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/loan/2501000101/transmittal");
  });

  test("shows borrower and property info", async ({ page }) => {
    await expect(page.locator("text=Sanchez, Maria")).toBeVisible();
    await expect(page.locator("text=Fresno")).toBeVisible();
    await expect(page.locator("text=BankStatement12")).toBeVisible();
  });

  test("shows conditions table", async ({ page }) => {
    await expect(page.locator("text=Conditions")).toBeVisible();
    await expect(page.locator("text=Open")).toBeVisible();
  });

  test("tab navigation works", async ({ page }) => {
    // Click 1003 Page 1 tab
    await page.click('a:has-text("1003 Page 1")');
    await expect(page).toHaveURL(/\/1003\/page1/);
    await expect(page.locator("text=Borrower Information")).toBeVisible();
  });

  test("decision bar is visible", async ({ page }) => {
    await expect(page.locator('button:has-text("Approve")').or(page.locator("text=Decision requires"))).toBeVisible();
  });

  test("agent buttons are visible", async ({ page }) => {
    await expect(page.locator('button:has-text("Multi-Agent")').or(page.locator("text=Agent requires"))).toBeVisible();
  });
});
