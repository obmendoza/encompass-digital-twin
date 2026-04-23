import { test, expect } from "@playwright/test";

const LOAN_ID = "2501000101";

const screens = [
  { path: `/loan/${LOAN_ID}/transmittal`, text: "Borrower" },
  { path: `/loan/${LOAN_ID}/1003/page1`, text: "Borrower Information" },
  { path: `/loan/${LOAN_ID}/1003/page2`, text: "Assets" },
  { path: `/loan/${LOAN_ID}/1003/page3`, text: "Transaction Details" },
  { path: `/loan/${LOAN_ID}/income`, text: "Income Summary" },
  { path: `/loan/${LOAN_ID}/efolder`, text: "eFolder" },
  { path: `/loan/${LOAN_ID}/credit`, text: "Credit" },
  { path: `/loan/${LOAN_ID}/appraisal`, text: "Appraisal" },
  { path: `/loan/${LOAN_ID}/compliance`, text: "Compliance" },
  { path: `/loan/${LOAN_ID}/log`, text: "Conversation Log" },
  { path: `/loan/${LOAN_ID}/overlays`, text: "Program Overlays" },
  { path: `/loan/${LOAN_ID}/conditions`, text: "Conditions" },
];

test.describe("Screen Navigation", () => {
  for (const screen of screens) {
    test(`${screen.path} loads correctly`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.locator(`text=${screen.text}`).first()).toBeVisible({ timeout: 15_000 });
    });
  }
});
