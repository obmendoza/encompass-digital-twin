import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/user.json");

setup("authenticate", async ({ page }) => {
  // Skip auth if no Supabase configured (local dev without auth)
  const hasAuth = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!hasAuth) {
    setup.skip();
    return;
  }

  await page.goto("/login");
  await page.fill('input[type="email"]', process.env.E2E_USER_EMAIL ?? "test@encompass-twin.com");
  await page.fill('input[type="password"]', process.env.E2E_USER_PASSWORD ?? "test123456");
  await page.click('button:has-text("Sign In")');
  await page.waitForURL("/");
  await page.context().storageState({ path: AUTH_FILE });
});
