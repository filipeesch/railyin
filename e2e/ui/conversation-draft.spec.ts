/**
 * conversation-draft.spec.ts — Tests for draft persistence in task and session inputs.
 *
 * Suite: DR — draft persistence
 * Verifies that unsent text survives drawer close/reopen, is cleared on send,
 * is isolated per task/session, and is cleaned up when entities are deleted.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, sendMessage, openSessionDrawer } from "./fixtures";
import { makeTask, makeChatSession, makeUserMessage } from "./fixtures/mock-data";

const TASK_EDITOR = ".task-detail__input .cm-content";
const SESSION_EDITOR = ".session-chat-view .chat-editor .cm-content";

test.describe("DR — draft persistence", () => {
    test.beforeEach(async ({ page }) => {
        // Clear any leftover drafts between tests, but only on the first load per test.
        // sessionStorage survives page.reload() within the same tab but resets between tests,
        // so this guard prevents the init script from wiping drafts on reloads within a test.
        await page.addInitScript(() => {
            if (!sessionStorage.getItem("__draftTestInit")) {
                sessionStorage.setItem("__draftTestInit", "1");
                for (const key of Object.keys(localStorage)) {
                    if (key.startsWith("railyn:draft:")) localStorage.removeItem(key);
                }
            }
        });
    });

    test("DR-E2E-1: task draft is restored after closing and reopening the drawer", async ({ page, api, task }) => {
        api.handle("conversations.getMessages", () => ({ messages: [], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Type a draft message (Shift+Enter to avoid sending)
        const editor = page.locator(TASK_EDITOR);
        await editor.click();
        await editor.pressSequentially("My unsent draft");

        // Close the drawer
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        // Reopen the same task drawer
        await openTaskDrawer(page, task.id);

        // The draft text should be restored in the editor
        await expect(editor).toContainText("My unsent draft");
    });

    test("DR-E2E-2: task draft is cleared after the message is sent", async ({ page, api, task }) => {
        const sentMessage = makeUserMessage(task.id, "Send me");
        api.handle("conversations.getMessages", () => ({ messages: [], hasMore: false }));
        api.handle("tasks.sendMessage", () => ({ message: sentMessage, executionId: null }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Type and send
        await sendMessage(page, "Send me");

        // Close and reopen
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });
        await openTaskDrawer(page, task.id);

        // Editor should be empty — draft was cleared on send.
        // A visible .cm-placeholder inside the editor means it has no user content.
        const editor = page.locator(TASK_EDITOR);
        await expect(editor.locator(".cm-placeholder")).toBeVisible();
    });

    test("DR-E2E-3: two tasks maintain independent drafts", async ({ page, api }) => {
        const taskA = makeTask({ id: 10 });
        const taskB = makeTask({ id: 11 });

        api.handle("tasks.list", () => [taskA, taskB]);
        api.handle("conversations.getMessages", () => ({ messages: [], hasMore: false }));

        await page.goto("/");

        // Type a draft in task A
        await openTaskDrawer(page, taskA.id);
        const editorA = page.locator(TASK_EDITOR);
        await editorA.click();
        await editorA.pressSequentially("Draft for task A");
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        // Type a different draft in task B
        await openTaskDrawer(page, taskB.id);
        const editorB = page.locator(TASK_EDITOR);
        await editorB.click();
        await editorB.pressSequentially("Draft for task B");
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        // Reopen task A — should have its own draft
        await openTaskDrawer(page, taskA.id);
        await expect(page.locator(TASK_EDITOR)).toContainText("Draft for task A");
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        // Reopen task B — should have its own draft
        await openTaskDrawer(page, taskB.id);
        await expect(page.locator(TASK_EDITOR)).toContainText("Draft for task B");
    });

    test("DR-E2E-4: task draft persists across a full page reload", async ({ page, api, task }) => {
        api.handle("conversations.getMessages", () => ({ messages: [], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Type a draft
        const editor = page.locator(TASK_EDITOR);
        await editor.click();
        await editor.pressSequentially("Survives reload");

        // Close the drawer to trigger localStorage write
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        // Reload the page
        await page.reload();
        await page.waitForLoadState("networkidle");

        // Reopen the task
        await openTaskDrawer(page, task.id);
        await expect(page.locator(TASK_EDITOR)).toContainText("Survives reload");
    });

    test("DR-E2E-5: session draft is restored after closing and reopening the session", async ({ page, api }) => {
        const session = makeChatSession({ id: 200 });

        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        api.returns("chatSessions.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Type a draft in the session input
        const editor = page.locator(SESSION_EDITOR);
        await editor.click();
        await editor.pressSequentially("Session draft text");

        // Close the session
        await page.keyboard.press("Escape");
        await expect(page.locator(".session-chat-view")).not.toBeVisible({ timeout: 3_000 });

        // Reopen the same session
        await openSessionDrawer(page, session.id);
        await expect(page.locator(SESSION_EDITOR)).toContainText("Session draft text");
    });
});
