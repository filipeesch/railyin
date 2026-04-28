/**
 * helpers.ts — Shared Playwright helper functions for chat drawer tests.
 *
 * Exported helpers are used across task-drawer, chat, and session specs
 * to avoid duplicating common navigation patterns.
 */

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Open the task drawer for the given task ID and wait for it to be visible. */
export async function openTaskDrawer(page: Page, taskId: number): Promise<void> {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

/** Type text into the task chat editor and press Enter to send. */
export async function sendMessage(page: Page, text: string): Promise<void> {
    const editor = page.locator(".task-detail__input .cm-content");
    await editor.click();
    await editor.pressSequentially(text);
    await page.keyboard.press("Enter");
}

/** Open the session chat sidebar and wait for it to be visible. */
export async function openSidebar(page: Page): Promise<void> {
    const btn = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
    const count = await btn.count();
    if (count > 0) await btn.first().click();
    await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });
}

/** Open the sidebar, click a session, and wait for the session chat view to appear. */
export async function openSessionDrawer(page: Page, sessionId: number): Promise<void> {
    await openSidebar(page);
    await page.locator(`[data-session-id="${sessionId}"]`).click();
    await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });
}

/** Type text into the session chat editor and submit (default: Enter). */
export async function typeInSessionEditor(
    page: Page,
    text: string,
    submitKey: "Enter" | "Shift+Enter" = "Enter",
): Promise<void> {
    const editor = page.locator(".session-chat-view .chat-editor .cm-content");
    await editor.click();
    await editor.pressSequentially(text);
    await page.keyboard.press(submitKey);
}
