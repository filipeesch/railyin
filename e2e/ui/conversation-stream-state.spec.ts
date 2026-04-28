/**
 * conversation-stream-state.spec.ts — Tests for stream state isolation between drawers.
 *
 * Suite: SS — stream state isolation
 * Verifies that streamed content is scoped to its task's conversation and
 * does not bleed across drawer switches.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, openSessionDrawer } from "./fixtures";
import { makeTask, makeChatSession } from "./fixtures/mock-data";
import type { StreamEvent } from "@shared/rpc-types";

function taskTextChunk(taskId: number, conversationId: number, seq: number, content: string): StreamEvent {
    return {
        taskId,
        conversationId,
        executionId: 9000 + taskId,
        seq,
        blockId: `${9000 + taskId}-text`,
        type: "text_chunk",
        content,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done: false,
    };
}

test.describe("SS — stream state isolation", () => {
    test("SS-1: task A's streamed content not visible in task B's conversation body", async ({ page, api, ws }) => {
        const taskA = makeTask({ id: 10 });
        const taskB = makeTask({ id: 11 });

        api.handle("tasks.list", () => [taskA, taskB]);
        api.handle("conversations.getMessages", () => ({ messages: [], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, taskA.id);

        // Push stream event scoped to taskA's conversation
        ws.pushStreamEvent(taskTextChunk(taskA.id, taskA.conversationId, 0, "Content for Task A only"));
        await expect(page.locator(".task-chat-view .msg__bubble.streaming")).toBeVisible({ timeout: 5_000 });

        // Close taskA
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        // Open taskB — should have empty conversation
        await openTaskDrawer(page, taskB.id);

        await expect(page.locator(".task-chat-view .msg__bubble.streaming")).not.toBeVisible();
        await expect(page.locator(".task-chat-view .msg--user")).toHaveCount(0);
        await expect(page.locator(".task-chat-view .msg--assistant")).toHaveCount(0);
    });

    test("SS-2: streaming content for task A persists after switching to session and back", async ({ page, api, ws }) => {
        const taskA = makeTask({ id: 12 });
        const session = makeChatSession({ id: 500 });

        api.handle("tasks.list", () => [taskA]);
        api.handle("conversations.getMessages", () => ({ messages: [], hasMore: false }));
        api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));
        api.returns("chatSessions.list", [session]);

        await page.goto("/");
        await openTaskDrawer(page, taskA.id);

        // Push stream event to taskA
        ws.pushStreamEvent(taskTextChunk(taskA.id, taskA.conversationId, 0, "Persisted streaming content"));
        await expect(page.locator(".task-chat-view .msg__bubble.streaming")).toBeVisible({ timeout: 5_000 });

        // Switch to session drawer
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        await openSessionDrawer(page, session.id);
        await expect(page.locator(".session-chat-view")).toBeVisible();

        // Return to taskA
        await page.keyboard.press("Escape");
        await openTaskDrawer(page, taskA.id);

        // taskA's streaming content should still be present
        await expect(page.locator(".task-chat-view .msg__bubble.streaming")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".task-chat-view .msg__bubble.streaming")).toContainText("Persisted streaming content");
    });
});
