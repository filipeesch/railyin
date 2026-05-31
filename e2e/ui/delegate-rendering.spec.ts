/**
 * delegate-rendering.spec.ts — UI tests for delegate tool call rendering.
 *
 * Suite S-D — delegate tool rendering:
 *   S-D1: delegate badge shows child count
 *   S-D2: expand → nested child tool call cards with correct tool names
 *   S-D3: digest assistant message renders job heading
 *   S-D4: children are hidden before expand
 */

import { test, expect } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { ConversationMessage } from "@shared/rpc-types";

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function makeDelegateMessages(taskId: number): ConversationMessage[] {
    const delegateCallId = "tc-delegate-1";
    const intent = "read auth and config in parallel";

    const delegateCall: ConversationMessage = {
        id: 1,
        taskId,
        conversationId: taskId,
        type: "tool_call",
        role: "assistant",
        content: JSON.stringify({
            type: "function",
            function: {
                name: "delegate",
                arguments: JSON.stringify({
                    intent,
                    tasks: [
                        { id: "auth", prompt: "Read src/auth.ts" },
                        { id: "config", prompt: "Read src/config.ts" },
                    ],
                }),
            },
            id: delegateCallId,
            display: { label: "", subject: intent },
        }),
        metadata: null,
        createdAt: new Date().toISOString(),
    };

    function makeChildToolCall(id: number, toolCallId: string, toolName: string, path: string): ConversationMessage[] {
        const call: ConversationMessage = {
            id,
            taskId,
            conversationId: taskId,
            type: "tool_call",
            role: "assistant",
            content: JSON.stringify({
                type: "function",
                function: {
                    name: toolName,
                    arguments: JSON.stringify({ path }),
                },
                id: toolCallId,
                display: { label: toolName, subject: path },
            }),
            metadata: { parent_tool_call_id: delegateCallId },
            createdAt: new Date().toISOString(),
        };
        const result: ConversationMessage = {
            id: id + 1,
            taskId,
            conversationId: taskId,
            type: "tool_result",
            role: "user",
            content: JSON.stringify({ tool_use_id: toolCallId, content: `contents of ${path}` }),
            metadata: null,
            createdAt: new Date().toISOString(),
        };
        return [call, result];
    }

    const delegateResult: ConversationMessage = {
        id: 6,
        taskId,
        conversationId: taskId,
        type: "tool_result",
        role: "user",
        content: JSON.stringify({
            tool_use_id: delegateCallId,
            content: "## Delegate Results\n\n### Job: auth\nauth contents\n\n### Job: config\nconfig contents",
        }),
        metadata: null,
        createdAt: new Date().toISOString(),
    };

    const digestMessage: ConversationMessage = {
        id: 7,
        taskId,
        conversationId: taskId,
        type: "assistant",
        role: "assistant",
        content: "## Delegate Results\n\n### Job: auth\nauth contents\n\n### Job: config\nconfig contents",
        metadata: null,
        createdAt: new Date().toISOString(),
    };

    return [
        delegateCall,
        ...makeChildToolCall(2, "tc-child-auth", "read_file", "src/auth.ts"),
        ...makeChildToolCall(4, "tc-child-config", "list_dir", "src/config.ts"),
        delegateResult,
        digestMessage,
    ];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("S-D1: delegate renders a divider showing the agent count", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: makeDelegateMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const divider = page.locator(".conversation-inner .delegate-divider");
    await expect(divider).toBeVisible({ timeout: 3_000 });
    await expect(divider).toContainText("2");
    await expect(divider).toContainText("agent");
});

test("S-D2: delegate divider shows correct plural label for multiple agents", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: makeDelegateMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const label = page.locator(".conversation-inner .delegate-divider__label");
    await expect(label).toBeVisible({ timeout: 3_000 });
    await expect(label).toContainText("agents");
});

test("S-D3: digest assistant message renders job heading", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: makeDelegateMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const assistantBlock = page.locator(".conversation-inner .msg--assistant").last();
    await expect(assistantBlock).toBeVisible({ timeout: 3_000 });
    await expect(assistantBlock).toContainText("Job: auth");
});

test("S-D4: delegate divider does not render any nested tool call cards", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: makeDelegateMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await expect(page.locator(".conversation-inner .delegate-divider")).toBeVisible({ timeout: 3_000 });
    // Child tool calls are not rendered as top-level .tc cards
    await expect(page.locator(".conversation-inner > * > .tc")).toHaveCount(0);
});
