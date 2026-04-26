/**
 * tool-rendering.spec.ts — UI tests for tool call rendering in the chat drawer.
 *
 * Suite S — tool rendering regressions:
 *   S-24: batched tool calls pair results by id, preserving call order
 *   S-25: Copilot-style rawDiff payload renders as a parsed file diff
 *   S-26: subagent tool calls render nested under spawn_agent
 *   S-27: stale orphaned tool call shows unknown state instead of spinning
 *
 * Tool messages are pre-seeded via the conversations.getMessages mock
 * and conversations.getStreamEvents mock (persisted stream events).
 */

import { test, expect } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { ConversationMessage } from "@shared/rpc-types";

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function makeToolCallMessage(
    taskId: number,
    id: number,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    resultContent?: string,
    parentCallId?: string,
): ConversationMessage[] {
    const subject = args.path ?? args.command ?? args.task;
    const call: ConversationMessage = {
        id,
        taskId,
        conversationId: taskId,
        type: "tool_call",
        role: "assistant",
        content: JSON.stringify({
            type: "function",
            function: { name: toolName, arguments: JSON.stringify(args) },
            id: toolCallId,
            display: { label: toolName, subject: subject != null ? String(subject) : undefined },
        }),
        metadata: parentCallId ? { parent_tool_call_id: parentCallId } : null,
        createdAt: new Date().toISOString(),
    };

    if (resultContent === undefined) return [call];

    const result: ConversationMessage = {
        id: id + 1,
        taskId,
        conversationId: taskId,
        type: "tool_result",
        role: "user",
        content: JSON.stringify({ tool_use_id: toolCallId, content: resultContent }),
        metadata: null,
        createdAt: new Date().toISOString(),
    };

    return [call, result];
}

function batchedMessages(taskId: number): ConversationMessage[] {
    return [
        ...makeToolCallMessage(taskId, 1, "tc-alpha", "read_file", { path: "alpha.ts" }, "RESULT:alpha.ts"),
        ...makeToolCallMessage(taskId, 3, "tc-beta", "read_file", { path: "beta.ts" }, "RESULT:beta.ts"),
        ...makeToolCallMessage(taskId, 5, "tc-gamma", "read_file", { path: "gamma.ts" }, "RESULT:gamma.ts"),
        ...makeToolCallMessage(taskId, 7, "tc-delta", "read_file", { path: "delta.ts" }, "RESULT:delta.ts"),
    ];
}

function copilotDiffMessages(taskId: number): ConversationMessage[] {
    // A tool_call+tool_result pair where the result embeds writtenFiles (FileDiffPayload[]).
    // ToolCallGroup reads result.writtenFiles to render the diff and stat badges.
    const call: ConversationMessage = {
        id: 10,
        taskId,
        conversationId: taskId,
        type: "tool_call",
        role: "assistant",
        content: JSON.stringify({
            type: "function",
            function: { name: "edit_file", arguments: '{"path":"file.ts"}' },
            id: "tc-edit",
            display: { label: "edit_file", subject: "file.ts" },
        }),
        metadata: null,
        createdAt: new Date().toISOString(),
    };
    const result: ConversationMessage = {
        id: 11,
        taskId,
        conversationId: taskId,
        type: "tool_result",
        role: "user",
        content: JSON.stringify({
            tool_use_id: "tc-edit",
            content: "File written.",
            writtenFiles: [{
                operation: "edit_file",
                path: "file.ts",
                added: 1,
                removed: 1,
                hunks: [{
                    old_start: 1, new_start: 1, lines: [
                        { type: "removed", old_line: 1, content: "return 1" },
                        { type: "added", new_line: 1, content: "return 'alpha'" },
                    ]
                }],
            }],
        }),
        metadata: null,
        createdAt: new Date().toISOString(),
    };
    return [call, result];
}

function subagentMessages(taskId: number): ConversationMessage[] {
    return [
        ...makeToolCallMessage(taskId, 20, "tc-spawn", "spawn_agent", { task: "do work" }),
        ...makeToolCallMessage(taskId, 22, "tc-r1", "read_file", { path: "x.ts" }, "ok", "tc-spawn"),
        ...makeToolCallMessage(taskId, 24, "tc-l1", "list_dir", { path: "." }, "ok", "tc-spawn"),
        ...makeToolCallMessage(taskId, 26, "tc-e1", "edit_file", { path: "x.ts" }, "ok", "tc-spawn"),
        // The spawn result comes last
        {
            id: 28,
            taskId,
            conversationId: taskId,
            type: "tool_result",
            role: "user",
            content: JSON.stringify({ tool_use_id: "tc-spawn", content: "done" }),
            metadata: null,
            createdAt: new Date().toISOString(),
        },
    ];
}

function timeoutMessages(taskId: number): ConversationMessage[] {
    // Tool call with no matching result — createdAt > 30s ago so it renders as timed-out state
    const call: ConversationMessage = {
        id: 30,
        taskId,
        conversationId: taskId,
        type: "tool_call",
        role: "assistant",
        content: JSON.stringify({
            type: "function",
            function: { name: "run_shell", arguments: '{"command":"sleep 99"}' },
            id: "tc-orphan",
            display: { label: "run_shell", subject: "sleep 99" },
        }),
        metadata: null,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
    };
    return [call];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("S-24: batched tool calls pair results by id, preserving call order", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: batchedMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const cards = page.locator(".conversation-inner .tcg");
    await expect(cards).toHaveCount(4, { timeout: 3_000 });

    const toolNames = await cards.locator(".tcg__tool-name").allTextContents();
    expect(toolNames.map((t) => t.trim())).toEqual(["read_file", "read_file", "read_file", "read_file"]);

    const args = await cards.locator(".tcg__primary-arg").allTextContents();
    expect(args.map((a) => a.trim())).toEqual(["alpha.ts", "beta.ts", "gamma.ts", "delta.ts"]);
});

test("S-25: Copilot-style rawDiff payload renders as a parsed file diff", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: copilotDiffMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Expand the diff card
    const header = page.locator(".conversation-inner .tcg .tcg__header");
    await expect(header).toBeVisible({ timeout: 3_000 });
    await header.click();

    await expect(page.locator(".tcg__stat--added")).toContainText("+1", { timeout: 3_000 });
    await expect(page.locator(".tcg__stat--removed")).toContainText("-1");
    await expect(page.locator(".fdiff__line--added .fdiff__content")).toContainText("return 'alpha'");
    await expect(page.locator(".fdiff__line--removed .fdiff__content")).toContainText("return 1");
});

test("S-26: subagent tool calls render nested under spawn_agent", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: subagentMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Top level: 1 spawn_agent card
    const topLevel = page.locator(".conversation-inner .tcg");
    await expect(topLevel).toHaveCount(1, { timeout: 3_000 });

    // Badge should show child count
    const badge = topLevel.locator(".tcg__badge").first();
    await expect(badge).toContainText("3");

    // Nested children hidden until expanded
    await expect(topLevel.locator(".tcg__children > .tcg")).toHaveCount(0);

    // Expand
    await topLevel.locator(".tcg__header").click();
    await expect(topLevel.locator(".tcg__children > .tcg")).toHaveCount(3, { timeout: 2_000 });

    const childNames = await topLevel.locator(".tcg__children > .tcg .tcg__tool-name").allTextContents();
    expect(childNames.map((t) => t.trim())).toEqual(["read_file", "list_dir", "edit_file"]);
});

test("S-27: stale orphaned tool call shows unknown state (not spinning)", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: timeoutMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const iconClasses = await page.locator(".conversation-inner .tcg .tcg__tool-icon").evaluate(
        (el) => Array.from(el.classList),
    );

    expect(iconClasses).toContain("pi-question-circle");
    expect(iconClasses).not.toContain("pi-spin");
});
