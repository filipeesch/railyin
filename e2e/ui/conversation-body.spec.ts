import { test, expect } from "./fixtures";
import { makeAssistantMessage, makeUserMessage } from "./fixtures/mock-data";
import type { ConversationMessage, StreamEvent } from "@shared/rpc-types";

const EXEC_ID = 30_001;

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

function makeStreamEvent(
    taskId: number,
    seq: number,
    type: StreamEvent["type"],
    content: string,
    overrides: Partial<StreamEvent> = {},
): StreamEvent {
    return {
        taskId,
        conversationId: taskId,
        executionId: EXEC_ID,
        seq,
        blockId: `${EXEC_ID}-${type}-${seq}`,
        type,
        content,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done: false,
        ...overrides,
    };
}

function makeToolMessages(taskId: number): ConversationMessage[] {
    const createdAt = new Date().toISOString();
    return [
        {
            id: 91_000,
            taskId,
            conversationId: taskId,
            type: "tool_call",
            role: "assistant",
            content: JSON.stringify({
                type: "function",
                function: { name: "read_file", arguments: JSON.stringify({ path: "alpha.ts" }) },
                id: "cb-tool-1",
                display: { label: "read_file", subject: "alpha.ts" },
            }),
            metadata: null,
            createdAt,
        },
        {
            id: 91_001,
            taskId,
            conversationId: taskId,
            type: "tool_result",
            role: "user",
            content: JSON.stringify({ tool_use_id: "cb-tool-1", content: "alpha contents" }),
            metadata: null,
            createdAt,
        },
        makeAssistantMessage(taskId, "Tool output summarized"),
    ];
}

test.describe("CB — conversation body coverage", () => {
    test("CB-1: reasoning and live text blocks render in order while streaming", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(makeStreamEvent(task.id, 0, "reasoning_chunk", "Thinking through the request", { blockId: `${EXEC_ID}-r1` }));
        ws.pushStreamEvent(makeStreamEvent(task.id, 1, "text_chunk", "Final streamed answer", { blockId: `${EXEC_ID}-t1` }));

        await expect(page.locator(".rb")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg__bubble.streaming")).toBeVisible({ timeout: 3_000 });

        const blocks = page.locator(".conv-body .rb, .conv-body .msg__bubble.streaming");
        await expect(blocks.nth(0)).toHaveClass(/rb/);
        await expect(blocks.nth(1)).toHaveClass(/streaming/);
    });

    test("CB-2: virtualized conversation only renders a subset of a long history at once", async ({ page, api, task }) => {
        const messages = Array.from({ length: 140 }, (_, index) =>
            index % 2 === 0
                ? makeUserMessage(task.id, `virtual user ${index}`, { id: 20_000 + index })
                : makeAssistantMessage(task.id, `virtual assistant ${index}`, { id: 20_000 + index }),
        );
        api.handle("conversations.getMessages", () => ({ messages: messages, hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const initialRendered = await page.locator(".conv-body .msg").count();
        expect(initialRendered).toBeGreaterThan(0);
        expect(initialRendered).toBeLessThan(messages.length);

        await page.locator(".conv-body").evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });

        await expect(page.locator(".conv-body .msg").filter({ hasText: "virtual assistant 139" })).toBeVisible({ timeout: 3_000 });
    });

    test("CB-3: mixed persisted tool groups and assistant messages render in the shared body", async ({ page, api, task }) => {
        api.handle("conversations.getMessages", () => ({
            messages: [
                ...makeToolMessages(task.id),
                makeUserMessage(task.id, "follow-up question"),
            ],
            hasMore: false,
        }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".conv-body .tcg")).toHaveCount(1);
        await expect(page.locator(".conv-body .tcg .tcg__tool-name")).toContainText("read_file");
        await expect(page.locator(".conv-body .msg--assistant")).toContainText("Tool output summarized");
        await expect(page.locator(".conv-body .msg--user")).toContainText("follow-up question");
    });
});
