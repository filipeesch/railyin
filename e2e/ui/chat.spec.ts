/**
 * chat.spec.ts — UI tests for task chat / conversation.
 *
 * Suites:
 *   M — basic send & streaming
 *   N — execution state
 *   O — persistence and multi-turn ordering
 *
 * Backend is fully mocked. Stream events are injected via WsMock.
 */

import { test, expect } from "./fixtures";
import { makeUserMessage, makeAssistantMessage } from "./fixtures/mock-data";
import type { Task, StreamEvent } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXEC_ID = 1001;

function textChunk(taskId: number, seq: number, content: string, done = false): StreamEvent {
    return {
        taskId,
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

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

async function sendMessage(page: import("@playwright/test").Page, text: string) {
    const editor = page.locator(".task-detail__input .cm-content");
    await editor.click();
    await editor.pressSequentially(text);
    await page.keyboard.press("Enter");
}

// ─── Suite M — basic send & streaming ────────────────────────────────────────

test.describe("M — basic send & streaming", () => {
    test("M-1: user message appears immediately in .msg--user after send", async ({ page, api, ws, task }) => {
        const messages = [makeUserMessage(task.id, "Hello from M-1")];

        api.handle("tasks.sendMessage", () => ({
            message: messages[0],
            executionId: EXEC_ID,
        }));
        api.handle("conversations.getMessages", () => messages);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const before = await page.locator(".msg--user").count();
        await sendMessage(page, "Hello from M-1");

        await expect(page.locator(".msg--user")).toHaveCount(before + 1);
    });

    test("M-2: streaming bubble (.msg__bubble.streaming) visible while streaming", async ({ page, api, ws, task }) => {
        let resolveStream!: () => void;
        const streamStarted = new Promise<void>((r) => (resolveStream = r));

        api.handle("tasks.sendMessage", async () => {
            // Push stream events after the HTTP response
            setTimeout(async () => {
                ws.pushStreamEvent(textChunk(task.id, 0, "Hello "));
                resolveStream();
            }, 50);
            return { message: makeUserMessage(task.id, "M-2 msg"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "M-2 msg");

        await streamStarted;
        await expect(page.locator(".msg__bubble.streaming")).toBeVisible();
    });

    test("M-3: assistant message persisted after streaming ends", async ({ page, api, ws, task }) => {
        const assistantMsg = makeAssistantMessage(task.id, "I have analysed your request.");
        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.pushStreamEvent(textChunk(task.id, 0, "I have analysed "));
                ws.pushStreamEvent(textChunk(task.id, 1, "your request."));
                ws.pushDone(task.id, EXEC_ID);
                // After done, the UI calls getMessages to load persisted messages
            }, 50);
            return { message: makeUserMessage(task.id, "M-3"), executionId: EXEC_ID };
        });
        api.handle("conversations.getMessages", () => [assistantMsg]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "M-3 msg");

        // Wait for streaming to end
        await expect(page.locator(".msg__bubble.streaming")).not.toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".msg--assistant")).toHaveCount(1);
    });

    test("M-4: assistant message content matches streamed text", async ({ page, api, ws, task }) => {
        const responseText = "I have analysed your codebase thoroughly.";
        const assistantMsg = makeAssistantMessage(task.id, responseText);

        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.pushStreamEvent(textChunk(task.id, 0, responseText));
                ws.pushDone(task.id, EXEC_ID);
            }, 50);
            return { message: makeUserMessage(task.id, "M-4"), executionId: EXEC_ID };
        });
        api.handle("conversations.getMessages", () => [assistantMsg]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "M-4 msg");

        await expect(page.locator(".msg__bubble.streaming")).not.toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".msg--assistant").last()).toContainText("analysed");
    });
});

// ─── Suite N — execution state ────────────────────────────────────────────────

test.describe("N — execution state in the UI", () => {
    test("N-5: task card gets .exec-running class while streaming", async ({ page, api, ws, task }) => {
        const runningTask: Task = { ...task, executionState: "running" };
        const completedTask: Task = { ...task, executionState: "completed" };

        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.push({ type: "task.updated", payload: runningTask });
                ws.pushStreamEvent(textChunk(task.id, 0, "streaming..."));
            }, 50);
            return { message: makeUserMessage(task.id, "N-5"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "N-5 msg");

        await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveClass(/exec-running/, { timeout: 5_000 });

        // Settle
        ws.push({ type: "task.updated", payload: completedTask });
        ws.pushDone(task.id, EXEC_ID);
    });

    test("N-6: stop button visible during streaming, send button absent", async ({ page, api, ws, task }) => {
        const runningTask: Task = { ...task, executionState: "running" };

        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.push({ type: "task.updated", payload: runningTask });
                ws.pushStreamEvent(textChunk(task.id, 0, "still streaming..."));
            }, 50);
            return { message: makeUserMessage(task.id, "N-6"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "N-6 msg");

        // Stop icon visible
        await expect(page.locator(".task-detail__input .pi-stop-circle")).toBeVisible({ timeout: 5_000 });
        // Send icon absent
        await expect(page.locator(".task-detail__input .pi-send")).not.toBeVisible();
    });

    test("N-7: task card gets .exec-completed after streaming ends", async ({ page, api, ws, task }) => {
        const completedTask: Task = { ...task, executionState: "completed" };

        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.push({ type: "task.updated", payload: { ...task, executionState: "running" } });
                ws.pushStreamEvent(textChunk(task.id, 0, "done"));
                ws.pushDone(task.id, EXEC_ID);
                setTimeout(() => ws.push({ type: "task.updated", payload: completedTask }), 50);
            }, 50);
            return { message: makeUserMessage(task.id, "N-7"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "N-7 msg");

        await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveClass(/exec-completed/, { timeout: 10_000 });
    });

    test("N-8: send button absent when textarea is empty", async ({ page, api, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Empty editor — send button must be disabled (not absent — it's always rendered)
        await expect(page.locator(".task-detail__input .cm-content")).toBeVisible();
        await expect(page.locator(".task-detail__input button:has(.pi-send)")).toBeDisabled();
    });
});

// ─── Suite O — persistence and multi-turn ordering ───────────────────────────

test.describe("O — persistence and multi-turn ordering", () => {
    test("O-9: messages survive drawer close and reopen", async ({ page, api, ws, task }) => {
        const msgs = [
            makeUserMessage(task.id, "first"),
            makeAssistantMessage(task.id, "first reply"),
        ];
        api.handle("conversations.getMessages", () => msgs);

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await expect(page.locator(".msg--assistant")).toHaveCount(1);

        // Close drawer
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        // Reopen
        await openTaskDrawer(page, task.id);
        await expect(page.locator(".msg--assistant")).toHaveCount(1);
    });

    test("O-10: two round-trips produce 4 messages in correct order", async ({ page, api, ws, task }) => {
        const msgs = [
            makeUserMessage(task.id, "Round 1"),
            makeAssistantMessage(task.id, "Reply 1"),
            makeUserMessage(task.id, "Round 2"),
            makeAssistantMessage(task.id, "Reply 2"),
        ];
        api.handle("conversations.getMessages", () => msgs);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".msg--user")).toHaveCount(2);
        await expect(page.locator(".msg--assistant")).toHaveCount(2);

        // Order: user → assistant → user → assistant
        const allMsgs = page.locator(".conversation-inner .msg");
        await expect(allMsgs.nth(0)).toHaveClass(/msg--user/);
        await expect(allMsgs.nth(1)).toHaveClass(/msg--assistant/);
        await expect(allMsgs.nth(2)).toHaveClass(/msg--user/);
        await expect(allMsgs.nth(3)).toHaveClass(/msg--assistant/);
    });

    test("O-11: no duplicate messages after drawer reopen", async ({ page, api, ws, task }) => {
        let callCount = 0;
        const msgs = [makeAssistantMessage(task.id, "only one")];
        api.handle("conversations.getMessages", () => {
            callCount++;
            return msgs;
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await expect(page.locator(".msg--assistant")).toHaveCount(1);

        await page.keyboard.press("Escape");
        await openTaskDrawer(page, task.id);

        // Still exactly 1 assistant message — no duplicates
        await expect(page.locator(".msg--assistant")).toHaveCount(1);
    });
});
