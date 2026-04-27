/**
 * queue-messages.spec.ts — UI tests for the message queue feature.
 *
 * Suites:
 *   Q  — Task context: queue, drain, edit, cancel, interview append
 *   QS — Session context: queue and drain
 *
 * The queue allows users to compose messages while the assistant is running.
 * Messages are sent automatically (batched) when the assistant turn ends.
 */

import { test, expect } from "./fixtures";
import { makeUserMessage, makeAssistantMessage, makeTask, makeChatSession } from "./fixtures/mock-data";
import type { Task, StreamEvent } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXEC_ID = 2001;
const EXEC_ID_2 = 2002;

function textChunk(taskId: number, seq: number, content: string, done = false): StreamEvent {
    return {
        taskId,
        conversationId: taskId,
        executionId: EXEC_ID,
        seq,
        blockId: `${EXEC_ID}-text`,
        type: "text_chunk",
        content,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done,
    };
}

function runningTask(task: Task): Task {
    return { ...task, executionState: "running" };
}

function idleTask(task: Task): Task {
    return { ...task, executionState: "idle" };
}

function completedTask(task: Task): Task {
    return { ...task, executionState: "completed" };
}

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

async function typeInEditor(page: import("@playwright/test").Page, text: string) {
    const editor = page.locator(".task-detail__input .cm-content");
    await editor.click();
    await editor.pressSequentially(text);
}

async function clickQueueBtn(page: import("@playwright/test").Page) {
    await page.locator('[data-testid="queue-btn"]').click();
}

async function openChatSidebar(page: import("@playwright/test").Page) {
    const btn = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
    const count = await btn.count();
    if (count > 0) await btn.first().click();
    await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });
}

async function openSessionDrawer(page: import("@playwright/test").Page, sessionId: number) {
    await openChatSidebar(page);
    await page.locator(`[data-session-id="${sessionId}"]`).click();
    await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });
}

// ─── Suite Q — Task context ────────────────────────────────────────────────────

test.describe("Q — queue messages (task context)", () => {
    test("Q-1: queue button is shown instead of send button when task is running", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator('[data-testid="queue-btn"]')).toBeVisible();
        await expect(page.locator('[data-testid="send-btn"]')).not.toBeVisible();
        await expect(page.locator('[data-testid="cancel-btn"]')).toBeVisible();
    });

    test("Q-2: clicking queue button adds a chip with the typed text", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "my queued message");
        await clickQueueBtn(page);

        await expect(page.locator('[data-testid="queue-chips"]')).toBeVisible();
        await expect(page.locator('[data-testid="queue-chips"]')).toContainText("my queued message");
    });

    test("Q-3: multiple messages can be queued (FIFO chips)", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "first");
        await clickQueueBtn(page);
        await typeInEditor(page, "second");
        await clickQueueBtn(page);

        const chips = page.locator('[data-testid="queue-chips"] .queue-row');
        await expect(chips).toHaveCount(2);
        await expect(chips.nth(0)).toContainText("first");
        await expect(chips.nth(1)).toContainText("second");
    });

    test("Q-4: clicking ✕ on a chip removes it", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "to remove");
        await clickQueueBtn(page);

        const chip = page.locator('[data-testid="queue-chips"] .queue-row').first();
        await chip.locator('[aria-label="Remove queued message"]').click();

        await expect(page.locator('[data-testid="queue-chips"]')).not.toBeVisible();
    });

    test("Q-5: clicking ✏ on chip loads text into editor and marks chip as editing", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "original text");
        await clickQueueBtn(page);

        const chip = page.locator('[data-testid="queue-chips"] .queue-row').first();
        await chip.locator('[aria-label="Edit queued message"]').click();

        // Editor should have been populated with original text
        const editor = page.locator(".task-detail__input .cm-content");
        await expect(editor).toContainText("original text");

        // Chip should be in ghost/editing state
        await expect(chip).toHaveClass(/queue-row--editing/);

        // Queue button should show "Update #1"
        await expect(page.locator('[data-testid="queue-btn"]')).toContainText("Update #1");
    });

    test("Q-6: confirming an edit updates the chip text in-place", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "old text");
        await clickQueueBtn(page);

        // Start edit
        const chip = page.locator('[data-testid="queue-chips"] .queue-row').first();
        await chip.locator('[aria-label="Edit queued message"]').click();

        // Clear editor and type new text
        const editor = page.locator(".task-detail__input .cm-content");
        await editor.selectText();
        await page.keyboard.press("Control+a");
        await editor.pressSequentially("new text");

        await page.locator('[data-testid="queue-btn"]').click();

        // Chip should now show new text
        await expect(chip).toContainText("new text");
        // No longer editing
        await expect(chip).not.toHaveClass(/queue-row--editing/);
    });

    test("Q-6b: edited chip text is sent on drain (not the original text)", async ({ page, api, ws, task }) => {
        const sentContents: string[] = [];

        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.handle("tasks.sendMessage", (body) => {
            sentContents.push((body as { content: string }).content);
            return { message: makeUserMessage(task.id, (body as { content: string }).content), executionId: EXEC_ID_2 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "original text");
        await clickQueueBtn(page);

        // Start editing — editor loads original text
        const chip = page.locator('[data-testid="queue-chips"] .queue-row').first();
        await chip.locator('[aria-label="Edit queued message"]').click();

        const editor = page.locator(".task-detail__input .cm-content");
        await expect(editor).toContainText("original text");

        // Clear editor (CM6: click + select-all + delete) then type revised text
        await editor.click();
        await page.keyboard.press("Meta+a");
        await page.keyboard.press("Control+a");
        await page.keyboard.press("Backspace");
        await editor.pressSequentially("revised text");
        await page.locator('[data-testid="queue-btn"]').click();

        // Chip should show revised text
        await expect(chip).toContainText("revised text");

        // Drain by completing the task
        ws.push({ type: "task.updated", payload: completedTask(task) });
        await page.waitForTimeout(500);

        expect(sentContents).toHaveLength(1);
        expect(sentContents[0]).toContain("revised text");
    });

    test("Q-7: cancel edit button restores normal queue button state", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "some message");
        await clickQueueBtn(page);

        // Start edit
        const chip = page.locator('[data-testid="queue-chips"] .queue-row').first();
        await chip.locator('[aria-label="Edit queued message"]').click();

        // Cancel edit
        await page.locator('[data-testid="queue-cancel-edit-btn"]').click();

        // Queue button should be back to normal
        await expect(page.locator('[data-testid="queue-btn"]')).not.toContainText("Update");
        // Chip should no longer be editing
        await expect(chip).not.toHaveClass(/queue-row--editing/);
    });

    test("Q-8: chips are cleared and messages are sent when task transitions running→completed", async ({ page, api, ws, task }) => {
        let capturedSend: unknown = null;

        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.handle("tasks.sendMessage", (body) => {
            capturedSend = body;
            return { message: makeUserMessage(task.id, (body as { content: string }).content), executionId: EXEC_ID_2 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "queued after run");
        await clickQueueBtn(page);
        await expect(page.locator('[data-testid="queue-chips"]')).toBeVisible();

        // Task finishes — transitions to completed
        ws.push({ type: "task.updated", payload: completedTask(task) });

        // Chips should disappear after drain
        await expect(page.locator('[data-testid="queue-chips"]')).not.toBeVisible({ timeout: 5000 });
        expect(capturedSend).not.toBeNull();
    });

    test("Q-9: multiple queued messages are batch-sent as one combined message on drain", async ({ page, api, ws, task }) => {
        const sentContents: string[] = [];

        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.handle("tasks.sendMessage", (body) => {
            sentContents.push((body as { content: string }).content);
            return { message: makeUserMessage(task.id, (body as { content: string }).content), executionId: EXEC_ID_2 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "msg one");
        await clickQueueBtn(page);
        await typeInEditor(page, "msg two");
        await clickQueueBtn(page);

        ws.push({ type: "task.updated", payload: completedTask(task) });

        // Wait for drain
        await page.waitForTimeout(500);

        // Exactly one sendMessage call with combined content
        expect(sentContents).toHaveLength(1);
        expect(sentContents[0]).toContain("msg one");
        expect(sentContents[0]).toContain("msg two");
    });

    test("Q-10: queue chips persist if task fails (no drain)", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "should persist");
        await clickQueueBtn(page);

        // Task fails
        ws.push({ type: "task.updated", payload: { ...task, executionState: "failed" } });

        // Chips should remain
        await page.waitForTimeout(300);
        await expect(page.locator('[data-testid="queue-chips"]')).toBeVisible();
        await expect(page.locator('[data-testid="queue-chips"]')).toContainText("should persist");
    });

    test("Q-11: queue chips persist if task is cancelled (no drain)", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "should persist after cancel");
        await clickQueueBtn(page);

        // Task cancelled
        ws.push({ type: "task.updated", payload: { ...task, executionState: "cancelled" } });

        await page.waitForTimeout(300);
        await expect(page.locator('[data-testid="queue-chips"]')).toBeVisible();
    });

    test("Q-11b: stop button cancels assistant and queue is preserved (not drained)", async ({ page, api, ws, task }) => {
        let cancelCalled = false;
        let sendCalled = false;

        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.handle("tasks.cancel", () => {
            cancelCalled = true;
            return { ...task, executionState: "cancelled" };
        });
        api.handle("tasks.sendMessage", () => {
            sendCalled = true;
            return { message: makeUserMessage(task.id, ""), executionId: EXEC_ID_2 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Queue a message while running
        await typeInEditor(page, "queued while running");
        await clickQueueBtn(page);
        await expect(page.locator('[data-testid="queue-chips"]')).toBeVisible();

        // Click stop — cancels the assistant
        await page.locator('[data-testid="cancel-btn"]').click();

        // Simulate backend cancel response: task transitions to cancelled
        ws.push({ type: "task.updated", payload: { ...task, executionState: "cancelled" } });
        await page.waitForTimeout(400);

        // Queue is preserved — user chose to stop, not continue
        await expect(page.locator('[data-testid="queue-chips"]')).toBeVisible();
        await expect(page.locator('[data-testid="queue-chips"]')).toContainText("queued while running");

        // Queue was NOT drained automatically
        expect(sendCalled).toBe(false);
    });

    test("Q-12: queue badge count shown on queue button when items queued", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "one");
        await clickQueueBtn(page);
        await typeInEditor(page, "two");
        await clickQueueBtn(page);

        // Badge should show count
        const badge = page.locator('[data-testid="queue-btn"] .p-badge');
        await expect(badge).toBeVisible();
        await expect(badge).toContainText("2");
    });

    test("Q-13: frozen indicator shown when executionState is waiting_user and chips exist", async ({ page, api, ws, task }) => {
        // Task starts running, user queues, then transitions to waiting_user
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "queued while running");
        await clickQueueBtn(page);

        // Transition to waiting_user
        ws.push({ type: "task.updated", payload: { ...task, executionState: "waiting_user" } });

        await expect(page.locator('[data-testid="queue-frozen-indicator"]')).toBeVisible({ timeout: 3000 });
    });

    test("Q-14: queue row shows full message text (no truncation)", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const longText = "a".repeat(60);
        await typeInEditor(page, longText);
        await clickQueueBtn(page);

        const row = page.locator('[data-testid="queue-chips"] .queue-row').first();
        const rowText = await row.locator(".queue-row__content").textContent();
        // Full text should be visible, not truncated
        expect(rowText).toContain("a".repeat(60));
        expect(rowText).not.toContain("…");
    });

    test("Q-15: send button is visible and queue button absent when task is idle", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [task]); // idle by default
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator('[data-testid="send-btn"]')).toBeVisible();
        await expect(page.locator('[data-testid="queue-btn"]')).not.toBeVisible();
    });

    test("Q-16: queue button disabled when editor is empty", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator('[data-testid="queue-btn"]')).toBeDisabled();
    });

    test("Q-17: editor is enabled (not read-only) while task is running", async ({ page, api, ws, task }) => {
        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const editor = page.locator(".task-detail__input .cm-content");
        // editor should be contenteditable (not disabled)
        const contentEditable = await editor.getAttribute("contenteditable");
        expect(contentEditable).toBe("true");
    });
});

// ─── Suite QS — Session context ───────────────────────────────────────────────

test.describe("QS — queue messages (session context)", () => {
    test("QS-1: queue button shown instead of send when session is running", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 901, title: "Test Chat", status: "running" });
        api.returns("chatSessions.list", [session]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.returns("conversations.contextUsage", { usedTokens: 0, maxTokens: 8192, fraction: 0 });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Session is running — queue button should appear in chat input
        await expect(page.locator('[data-testid="queue-btn"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="send-btn"]')).not.toBeVisible();
    });

    test("QS-2: queued messages are batch-sent when session transitions running→idle", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 902, title: "QS-2 Chat", status: "running" });
        const sentContents: string[] = [];

        api.returns("chatSessions.list", [session]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.returns("conversations.contextUsage", { usedTokens: 0, maxTokens: 8192, fraction: 0 });
        api.handle("chatSessions.sendMessage", (body) => {
            sentContents.push((body as { content: string }).content);
            return { executionId: -1, message: null };
        });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Type and queue a message
        const editor = page.locator(".session-chat-view .cm-content");
        await editor.click();
        await editor.pressSequentially("session queued msg");
        await page.locator('[data-testid="queue-btn"]').click();

        // Transition session to idle — drain should fire
        ws.pushChatSessionUpdated({ ...session, status: "idle" });
        await page.waitForTimeout(500);

        expect(sentContents.length).toBeGreaterThan(0);
        expect(sentContents[0]).toContain("session queued msg");
        await expect(page.locator('[data-testid="queue-chips"]')).not.toBeVisible();
    });

    test("QS-3: queued messages drain via stream.event done (production path)", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 903, title: "QS-3 Chat", status: "running" });
        const sentContents: string[] = [];

        api.returns("chatSessions.list", [session]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.returns("conversations.contextUsage", { usedTokens: 0, maxTokens: 8192, fraction: 0 });
        api.handle("chatSessions.sendMessage", (body) => {
            sentContents.push((body as { content: string }).content);
            return { executionId: -1, message: null };
        });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const editor = page.locator(".session-chat-view .cm-content");
        await editor.click();
        await editor.pressSequentially("production drain test");
        await page.locator('[data-testid="queue-btn"]').click();

        // Simulate production path: stream.event done (no chatSession.updated broadcast)
        ws.pushSessionDone(session.conversationId, EXEC_ID);
        await page.waitForTimeout(500);

        expect(sentContents.length).toBeGreaterThan(0);
        expect(sentContents[0]).toContain("production drain test");
        await expect(page.locator('[data-testid="queue-chips"]')).not.toBeVisible();
    });
});

test.describe("Q-bg — background drain (drawer closed)", () => {
    test("Q-18: task queue drains silently when task completes with drawer closed", async ({ page, api, ws, task }) => {
        let sendCalled = false;

        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.handle("tasks.sendMessage", (body) => {
            sendCalled = true;
            return { message: makeUserMessage(task.id, (body as { content: string }).content), executionId: EXEC_ID_2 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "background queued");
        await clickQueueBtn(page);
        await expect(page.locator('[data-testid="queue-chips"]')).toBeVisible();

        // Close the drawer by clicking elsewhere / pressing Escape
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        // Task completes in the background
        ws.push({ type: "task.updated", payload: completedTask(task) });
        await page.waitForTimeout(500);

        // Drain fired without the drawer being open
        expect(sendCalled).toBe(true);
    });

    test("Q-19: task queue drains via stream.event done fallback", async ({ page, api, ws, task }) => {
        let sendCalled = false;

        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.handle("tasks.sendMessage", (body) => {
            sendCalled = true;
            return { message: makeUserMessage(task.id, (body as { content: string }).content), executionId: EXEC_ID_2 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await typeInEditor(page, "stream done drain");
        await clickQueueBtn(page);

        // Trigger drain via stream.event done only (no task.updated first)
        ws.pushDone(task.id, EXEC_ID);
        await page.waitForTimeout(500);

        expect(sendCalled).toBe(true);
        await expect(page.locator('[data-testid="queue-chips"]')).not.toBeVisible({ timeout: 3_000 });
    });

    test("Q-20: after task ends with queue drained, user can send a new direct message", async ({ page, api, ws, task }) => {
        const sentContents: string[] = [];

        api.handle("tasks.list", () => [runningTask(task)]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });
        api.handle("tasks.sendMessage", (body) => {
            sentContents.push((body as { content: string }).content);
            return { message: makeUserMessage(task.id, (body as { content: string }).content), executionId: EXEC_ID_2 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Queue a message while running
        await typeInEditor(page, "queued msg");
        await clickQueueBtn(page);

        // Task completes — drain fires, send button should reappear
        ws.push({ type: "task.updated", payload: completedTask(task) });
        await page.waitForTimeout(500);

        // Queue is gone, send button is back
        await expect(page.locator('[data-testid="queue-chips"]')).not.toBeVisible({ timeout: 3_000 });
        await expect(page.locator('[data-testid="send-btn"]')).toBeVisible({ timeout: 3_000 });

        // User can type and send a new direct message
        await typeInEditor(page, "follow-up message");
        await page.locator('[data-testid="send-btn"]').click();
        await page.waitForTimeout(300);

        expect(sentContents.some(c => c.includes("follow-up message"))).toBe(true);
    });
});
