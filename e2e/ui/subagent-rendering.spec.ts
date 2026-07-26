/**
 * subagent-rendering.spec.ts — Tests for subagent bubble rendering in the UI.
 *
 * Suite SR — subagent rendering
 * Verifies that subagent bubbles appear correctly for both single and
 * multiple web_search agents.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { StreamEvent } from "@shared/rpc-types";

function makeToolCallEvent(
    taskId: number,
    conversationId: number,
    executionId: number,
    blockId: string,
    toolName: string,
    args: Record<string, unknown>,
    seq: number,
    subagentId: string | null = null,
): StreamEvent {
    return {
        taskId,
        conversationId,
        executionId,
        seq,
        blockId,
        type: "tool_call",
        content: JSON.stringify({
            type: "function",
            function: { name: toolName, arguments: JSON.stringify(args) },
            id: blockId,
            display: { label: toolName, subject: JSON.stringify(args) },
        }),
        metadata: null,
        parentBlockId: null,
        subagentId,
        done: false,
    };
}

function makeToolResultEvent(
    taskId: number,
    conversationId: number,
    executionId: number,
    blockId: string,
    result: string,
    seq: number,
    subagentId: string | null = null,
    metadata: Record<string, unknown> | null = null,
): StreamEvent {
    return {
        taskId,
        conversationId,
        executionId,
        seq,
        blockId,
        type: "tool_result",
        content: JSON.stringify({
            type: "tool_result",
            tool_use_id: blockId,
            content: result,
        }),
        metadata: metadata ? JSON.stringify(metadata) : null,
        parentBlockId: null,
        subagentId,
        done: true,
    };
}

test.describe("SR — subagent rendering", () => {
    test("SR-1: single web_search agent shows subagent bubble", async ({ page, api, ws }) => {
        const task = makeTask({ id: 101 });
        const convId = task.conversationId;
        const execId = 9001;

        api.handle("tasks.list", () => [task]);
        api.handle("conversations.getMessages", () => ({ messages: [], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Simulate the exact IPC event flow for a single web_search agent:
        // [0] tool_call tc-1 (web_search)
        // [1] tool_call sa-1 (subagent)
        // [2] tool_result sa-1 (subagent result)
        // [3] tool_result tc-1 (web_search result)
        // [4] done

        ws.pushStreamEvent(makeToolCallEvent(task.id, convId, execId, "tc-1", "web_search", { prompt: "test query" }, 0));
        ws.pushStreamEvent(makeToolCallEvent(task.id, convId, execId, "sa-1", "subagent", { intent: "web-search-123", prompt: "test query" }, 1, "sa-1"));
        ws.pushStreamEvent(makeToolResultEvent(task.id, convId, execId, "sa-1", "## Answer\nFound it.", 2, "sa-1", { resultContent: "## Answer\nFound it.", isError: false }));
        ws.pushStreamEvent(makeToolResultEvent(task.id, convId, execId, "tc-1", "## Answer\nFound it.", 3, null, { tool_call_id: "tc-1" }));
        ws.pushDone(task.id, execId, 4, convId);

        // The subagent bubble should appear
        const subagentBubble = page.locator(".conversation-inner .sa__header");
        await expect(subagentBubble).toBeVisible({ timeout: 5_000 });
        await expect(subagentBubble).toContainText("web-search-123");

        // The subagent bubble should be marked as done
        const doneIcon = subagentBubble.locator(".pi-check-circle");
        await expect(doneIcon).toBeVisible();
    });

    test("SR-2: multiple web_search agents show all subagent bubbles", async ({ page, api, ws }) => {
        const task = makeTask({ id: 102 });
        const convId = task.conversationId;
        const execId = 9002;

        api.handle("tasks.list", () => [task]);
        api.handle("conversations.getMessages", () => ({ messages: [], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Simulate multiple subagent event flow:
        // [0] tool_call tc-1
        // [1] tool_call tc-2
        // [2] tool_call sa-1
        // [3] tool_call sa-2
        // [4] tool_result sa-1
        // [5] tool_result sa-2
        // [6] tool_result tc-1
        // [7] tool_result tc-2
        // [8] done

        ws.pushStreamEvent(makeToolCallEvent(task.id, convId, execId, "tc-1", "web_search", { prompt: "query A" }, 0));
        ws.pushStreamEvent(makeToolCallEvent(task.id, convId, execId, "tc-2", "web_search", { prompt: "query B" }, 1));
        ws.pushStreamEvent(makeToolCallEvent(task.id, convId, execId, "sa-1", "subagent", { intent: "search-A", prompt: "query A" }, 2, "sa-1"));
        ws.pushStreamEvent(makeToolCallEvent(task.id, convId, execId, "sa-2", "subagent", { intent: "search-B", prompt: "query B" }, 3, "sa-2"));
        ws.pushStreamEvent(makeToolResultEvent(task.id, convId, execId, "sa-1", "Result A.", 4, "sa-1", { resultContent: "Result A.", isError: false }));
        ws.pushStreamEvent(makeToolResultEvent(task.id, convId, execId, "sa-2", "Result B.", 5, "sa-2", { resultContent: "Result B.", isError: false }));
        ws.pushStreamEvent(makeToolResultEvent(task.id, convId, execId, "tc-1", "Result A.", 6, null, { tool_call_id: "tc-1" }));
        ws.pushStreamEvent(makeToolResultEvent(task.id, convId, execId, "tc-2", "Result B.", 7, null, { tool_call_id: "tc-2" }));
        ws.pushDone(task.id, execId, 8, convId);

        // Both subagent bubbles should appear
        const subagentBubbles = page.locator(".conversation-inner .sa__header");
        await expect(subagentBubbles).toHaveCount(2, { timeout: 5_000 });
        await expect(subagentBubbles.nth(0)).toContainText("search-A");
        await expect(subagentBubbles.nth(1)).toContainText("search-B");
    });
});
