import type { Page } from "@playwright/test";
import type { ApiMock } from "./mock-api";
import { expect } from "@playwright/test";

/**
 * Navigate to /setup. Sets boards.list=[] so App.vue redirects to /setup
 * (it redirects to /board when boards exist). After this returns, callers
 * can set api.returns("boards.list", [...]) before clicking the Boards tab —
 * the tab-change handler re-fetches boards on activation.
 */
export async function goToSetup(page: Page, api: ApiMock): Promise<void> {
  api.returns("boards.list", []);
  await page.goto("/");
  await expect(page.locator(".setup-card")).toBeVisible({ timeout: 5_000 });
}
