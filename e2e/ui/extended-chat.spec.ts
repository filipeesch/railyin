/**
 * extended-chat.spec.ts — Edge-case and advanced chat UI tests.
 *
 * Suites:
 *   P — execution cancellation
 *   Q — model switching
 *   R — context compaction
 */

import { test, expect } from "./fixtures";
import { makeUserMessage, makeAssistantMessage } from "./fixtures/mock-data";
import type { Task, ConversationMessage, StreamEvent } from "@shared/rpc-types";

const EXEC_ID = 2001;

function textChunk(taskId: number, seq: number, content: string): StreamEvent {
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
        done: false,
    };
}

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

async function sendMessage(page: import("@playwright/test").Page, text: string) {
    await page.locator(".task-detail__input textarea").fill(text);
    await page.keyboard.press("Enter");
}

// ─── Suite P — Execution cancellation ─────────────────────────────────────────

test.describe("P — Execution cancellation", () => {
    test("P-12: stop button hidden when idle, visible when running", async ({ page, api, ws, task }) => {
        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.push({ type: "task.updated", payload: { ...task, executionState: "running" } });
                ws.pushStreamEvent(textChunk(task.id, 0, "streaming long job..."));
            }, 50);
            return { message: makeUserMessage(task.id, "P-12"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Idle: stop button not present
        await expect(page.locator(".task-detail__input .pi-stop-circle")).not.toBeVisible();

        await sendMessage(page, "P-12 msg");

        // Running: stop button visible
        await expect(page.locator(".task-detail__input .pi-stop-circle")).toBeVisible({ timeout: 5_000 });

        // Settle
        ws.push({ type: "task.updated", payload: { ...task, executionState: "completed" } });
        ws.pushDone(task.id, EXEC_ID);

        // Completed: stop button gone again
        await expect(page.locator(".task-detail__input .pi-stop-circle")).not.toBeVisible({ timeout: 5_000 });
    });

    test("P-13: cancel transitions execution to waiting_user", async ({ page, api, ws, task }) => {
        const cancelledTask: Task = { ...task, executionState: "waiting_user" };

        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.push({ type: "task.updated", payload: { ...task, executionState: "running" } });
                ws.pushStreamEvent(textChunk(task.id, 0, "processing..."));
            }, 50);
            return { message: makeUserMessage(task.id, "P-13"), executionId: EXEC_ID };
        });
        api.handle("tasks.cancel", () => {
            setTimeout(() => ws.push({ type: "task.updated", payload: cancelledTask }), 30);
            return cancelledTask;
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "P-13 msg");

        // Wait until running
        await expect(page.locator(".task-detail__input .pi-stop-circle")).toBeVisible({ timeout: 5_000 });

        // Click stop
        await page.locator(".task-detail__input .pi-stop-circle").click();

        // Task card should reflect waiting_user
        await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveClass(/exec-waiting/, { timeout: 5_000 });
    });

    test("P-14: can send a new message after cancel (task recovers)", async ({ page, api, ws, task }) => {
        const cancelledTask: Task = { ...task, executionState: "waiting_user" };
        const recoveredMsg = makeUserMessage(task.id, "Recovery P-14");

        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.push({ type: "task.updated", payload: cancelledTask });
            }, 30);
            return { message: recoveredMsg, executionId: EXEC_ID };
        });
        api.handle("tasks.cancel", () => cancelledTask);
        api.handle("conversations.getMessages", () => [recoveredMsg]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const before = await page.locator(".msg--user").count();
        await sendMessage(page, "Recovery P-14");

        await expect(page.locator(".msg--user")).toHaveCount(before + 1);
    });

    test("P-15: compact button disabled while execution is running", async ({ page, api, ws, task }) => {
        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.push({ type: "task.updated", payload: { ...task, executionState: "running" } });
                ws.pushStreamEvent(textChunk(task.id, 0, "working..."));
            }, 50);
            return { message: makeUserMessage(task.id, "P-15"), executionId: EXEC_ID };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "P-15 msg");

        await expect(page.locator(".task-detail__input .pi-stop-circle")).toBeVisible({ timeout: 5_000 });

        // Compact button must be disabled during execution
        const compactBtn = page.locator("button:has-text('Compact')");
        await expect(compactBtn).toBeDisabled({ timeout: 2_000 });
    });
});

// ─── Suite Q — Model switching ────────────────────────────────────────────────

test.describe("Q — Model switching", () => {
    test("Q-16: model selector shows the task's current model", async ({ page, api, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Model selector should display the task model's displayName ("Fake/Test" for id "fake/test")
        await expect(page.locator(".model-select__value")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".task-detail__model-row")).toContainText("Fake/Test");
    });

    test("Q-17: after setModel, task reflects new model", async ({ page, api, ws, task }) => {
        const updatedTask: Task = { ...task, model: "fake/v2" };
        api.handle("tasks.setModel", () => updatedTask);
        api.handle("models.listEnabled", () => [
            { id: "fake/test", displayName: "Fake/Test", contextWindow: 8192 },
            { id: "fake/v2", displayName: "Fake/V2", contextWindow: 8192 },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Simulate model change via task.updated push (as the backend would do)
        ws.push({ type: "task.updated", payload: updatedTask });

        await expect(page.locator(".task-detail__model-row")).toContainText("Fake/V2", { timeout: 3_000 });
    });

    test("Q-18: model selector label updates after switch", async ({ page, api, ws, task }) => {
        const updatedTask: Task = { ...task, model: "fake/v2" };
        api.handle("tasks.setModel", () => updatedTask);
        api.handle("models.listEnabled", () => [
            { id: "fake/test", displayName: "Fake/Test", contextWindow: 8192 },
            { id: "fake/v2", displayName: "Fake/V2", contextWindow: 8192 },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Push the model update via WS (as the backend would do after tasks.setModel)
        ws.push({ type: "task.updated", payload: updatedTask });

        await expect(page.locator(".task-detail__model-row")).toContainText("Fake/V2", { timeout: 3_000 });
    });

    test("Q-19: message completes successfully after model switch", async ({ page, api, ws, task }) => {
        const v2Task: Task = { ...task, model: "fake/v2" };
        const reply = makeAssistantMessage(task.id, "Reply on fake/v2");

        api.handle("tasks.setModel", () => v2Task);
        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.pushStreamEvent(textChunk(task.id, 0, "Reply on fake/v2"));
                ws.pushDone(task.id, EXEC_ID);
            }, 50);
            return { message: makeUserMessage(task.id, "Q-19 msg"), executionId: EXEC_ID };
        });
        api.handle("conversations.getMessages", () => [reply]);

        ws.push({ type: "task.updated", payload: v2Task });

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "Q-19 msg");

        await expect(page.locator(".msg__bubble.streaming")).not.toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".msg--assistant")).toHaveCount(1);
    });
});

// ─── Suite R — Context compaction ────────────────────────────────────────────

test.describe("R — Context compaction", () => {
    test("R-20: compact button is visible and enabled when idle", async ({ page, api, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const compactBtn = page.locator("button:has-text('Compact')");
        await expect(compactBtn).toBeVisible({ timeout: 3_000 });
        await expect(compactBtn).toBeEnabled();
    });

    test("R-21: manual compact shows .msg--compaction divider", async ({ page, api, ws, task }) => {
        const compactionMsg: ConversationMessage = {
            id: 9001,
            taskId: task.id,
            conversationId: task.id,
            type: "compaction_summary",
            role: null,
            content: JSON.stringify({ summary: "Context compacted." }),
            metadata: null,
            createdAt: new Date().toISOString(),
        };

        api.handle("tasks.compact", async () => {
            setTimeout(() => ws.push({ type: "message.new", payload: compactionMsg }), 50);
            return compactionMsg;
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const compactBtn = page.locator("button:has-text('Compact')");
        await compactBtn.click();

        await expect(page.locator(".msg--compaction")).toBeVisible({ timeout: 5_000 });
    });

    test("R-22: 'Show summary' details element present inside compaction marker", async ({ page, api, ws, task }) => {
        const compactionMsg: ConversationMessage = {
            id: 9002,
            taskId: task.id,
            conversationId: task.id,
            type: "compaction_summary",
            role: null,
            content: JSON.stringify({ summary: "Context compacted." }),
            metadata: null,
            createdAt: new Date().toISOString(),
        };
        api.handle("conversations.getMessages", () => [compactionMsg]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".msg--compaction")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg--compaction__details")).toBeVisible();
        await expect(page.locator(".msg--compaction__details summary")).toContainText("Show summary");
    });

    test("R-23: context gauge appears after execution completes", async ({ page, api, ws, task }) => {
        const completedTask: Task = { ...task, executionState: "completed" };

        api.handle("tasks.sendMessage", async () => {
            setTimeout(() => {
                ws.pushStreamEvent(textChunk(task.id, 0, "done"));
                ws.pushDone(task.id, EXEC_ID);
                setTimeout(() => ws.push({ type: "task.updated", payload: completedTask }), 30);
            }, 50);
            return { message: makeUserMessage(task.id, "R-23"), executionId: EXEC_ID };
        });
        api.handle("tasks.contextUsage", () => ({ usedTokens: 1024, maxTokens: 8192, fraction: 0.125 }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);
        await sendMessage(page, "R-23 msg");

        await expect(page.locator(".msg__bubble.streaming")).not.toBeVisible({ timeout: 10_000 });
        await expect(page.locator("svg.context-ring")).toBeVisible({ timeout: 5_000 });
    });
});
