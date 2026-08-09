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
    const sidebar = page.locator(".chat-sidebar");
    const isAlreadyOpen = await sidebar.isVisible();
    if (!isAlreadyOpen) {
        const btn = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
        const count = await btn.count();
        if (count > 0) await btn.first().click();
    }
    await expect(sidebar).toBeVisible({ timeout: 3_000 });
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

/** Open the Notes tab in the session chat view and wait for it to be visible. */
export async function openSessionNotesTab(page: Page): Promise<void> {
    await page.locator(".scv-tab-btn", { hasText: "Notes" }).click();
    await expect(page.locator(".notes-panel")).toBeVisible({ timeout: 3_000 });
}

/**
 * Chat-surface helpers (plan 06-01, Task 2): extracted VERBATIM from
 * chat-copilotkit.spec.ts:31-59 (the frozen canonical spec — Pitfall 8) so
 * migrated specs consume them from the shared fixture layer instead of
 * re-declaring them. The canonical spec keeps its own inline copies untouched.
 */

/** The CopilotChatInput textarea inside our #input slot wrapper. */
export function chatTextarea(page: Page) {
    return page.locator('[data-testid="chat-input"] textarea');
}

/** Track POSTs to /agent/default/connect (the CHAT-07 replay requests).
 *  The threadId arrives in the request BODY (parseConnectRequest mirrors the
 *  real runtime) — extract and record it. */
export function collectConnectRequests(page: Page): string[] {
    const requests: string[] = [];
    page.on("request", (req) => {
        if (req.method() === "POST" && /\/agent\/default\/connect$/.test(new URL(req.url()).pathname)) {
            try {
                const body = JSON.parse(req.postData() ?? "{}") as { threadId?: unknown };
                if (typeof body.threadId === "string") requests.push(body.threadId);
            } catch {
                // Malformed body — ignore; the fixture route mirrors the 400.
            }
        }
    });
    return requests;
}

export async function submitChatMessage(page: Page, text: string): Promise<void> {
    const input = chatTextarea(page);
    await input.click();
    await input.pressSequentially(text);
    await page.keyboard.press("Enter");
}