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

    const cards = page.locator(".conversation-inner .tc");
    await expect(cards).toHaveCount(4, { timeout: 3_000 });

    const toolNames = await cards.locator(".tc__tool-name").allTextContents();
    expect(toolNames.map((t) => t.trim())).toEqual(["read_file", "read_file", "read_file", "read_file"]);

    const args = await cards.locator(".tc__primary-arg").allTextContents();
    expect(args.map((a) => a.trim())).toEqual(["alpha.ts", "beta.ts", "gamma.ts", "delta.ts"]);
});

test("S-25: Copilot-style rawDiff payload renders as a parsed file diff", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: copilotDiffMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Expand the diff card
    const header = page.locator(".conversation-inner .tc .tc__header");
    await expect(header).toBeVisible({ timeout: 3_000 });
    await header.click();

    await expect(page.locator(".tc__stat--added")).toContainText("+1", { timeout: 3_000 });
    await expect(page.locator(".tc__stat--removed")).toContainText("-1");
    await expect(page.locator(".fdiff__line--added .fdiff__content")).toContainText("return 'alpha'");
    await expect(page.locator(".fdiff__line--removed .fdiff__content")).toContainText("return 1");

    // Gutter line numbers: old and new columns must be visually separated and show distinct values
    const addedLine = page.locator(".fdiff__line--added");
    const oldGutter = addedLine.locator(".fdiff__gutter--old");
    const newGutter = addedLine.locator(".fdiff__gutter--new");
    // added line has no old_line — gutter is empty; new line number is 1
    await expect(oldGutter).toHaveText("");
    await expect(newGutter).toHaveText("1");

    // The two gutters must not be visually merged — old gutter has a right border
    const hasBorder = await oldGutter.evaluate((el) => {
        const style = getComputedStyle(el);
        return style.borderRightWidth !== "0px" && style.borderRightStyle !== "none";
    });
    expect(hasBorder).toBe(true);
});

test("S-26: subagent tool calls render nested under spawn_agent", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: subagentMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Top level: 1 spawn_agent card
    const topLevel = page.locator(".conversation-inner .tc");
    await expect(topLevel).toHaveCount(1, { timeout: 3_000 });

    // Badge should show child count
    const badge = topLevel.locator(".tc__badge").first();
    await expect(badge).toContainText("3");

    // Nested children hidden until expanded
    await expect(topLevel.locator(".tc__children > .tc")).toHaveCount(0);

    // Expand
    await topLevel.locator(".tc__header").click();
    await expect(topLevel.locator(".tc__children > .tc")).toHaveCount(3, { timeout: 2_000 });

    const childNames = await topLevel.locator(".tc__children > .tc .tc__tool-name").allTextContents();
    expect(childNames.map((t) => t.trim())).toEqual(["read_file", "list_dir", "edit_file"]);
});

test("S-27: stale orphaned tool call shows unknown state (not spinning)", async ({ page, api, task }) => {
    api.handle("conversations.getMessages", () => ({ messages: timeoutMessages(task.id), hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const iconClasses = await page.locator(".conversation-inner .tc .tc__tool-icon").evaluate(
        (el) => Array.from(el.classList),
    );

    expect(iconClasses).toContain("pi-question-circle");
    expect(iconClasses).not.toContain("pi-spin");
});

test("S-28: FileDiff body creates real horizontal scroll for long lines", async ({ page, api, task }) => {
    const longLine = "x".repeat(300);
    const call: ConversationMessage = {
        id: 40, taskId: task.id, conversationId: task.id, type: "tool_call", role: "assistant",
        content: JSON.stringify({
            type: "function",
            function: { name: "edit_file", arguments: '{"path":"long.ts"}' },
            id: "tc-long",
            display: { label: "edit_file", subject: "long.ts" },
        }),
        metadata: null, createdAt: new Date().toISOString(),
    };
    const result: ConversationMessage = {
        id: 41, taskId: task.id, conversationId: task.id, type: "tool_result", role: "user",
        content: JSON.stringify({
            tool_use_id: "tc-long",
            content: "ok",
            writtenFiles: [{
                operation: "edit_file", path: "long.ts", added: 1, removed: 0,
                hunks: [{ old_start: 1, new_start: 1, lines: [{ type: "added", new_line: 1, content: longLine }] }],
            }],
        }),
        metadata: null, createdAt: new Date().toISOString(),
    };
    api.handle("conversations.getMessages", () => ({ messages: [call, result], hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);
    await page.locator(".conversation-inner .tc .tc__header").click();

    // fdiff__body must be scrollable (scrollWidth > clientWidth) for long content
    const isScrollable = await page.locator(".fdiff__body").evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(isScrollable).toBe(true);
});

test("S-29: read_file tool shows actual file content, not summary", async ({ page, api, task }) => {
    const fileContent = "line 1\nline 2\nline 3";
    const call: ConversationMessage = {
        id: 50, taskId: task.id, conversationId: task.id, type: "tool_call", role: "assistant",
        content: JSON.stringify({
            type: "function",
            function: { name: "view", arguments: '{"path":"src/app.ts"}' },
            id: "tc-read",
            display: { label: "view", subject: "src/app.ts", contentType: "file" },
        }),
        metadata: null, createdAt: new Date().toISOString(),
    };
    const result: ConversationMessage = {
        id: 51, taskId: task.id, conversationId: task.id, type: "tool_result", role: "user",
        content: JSON.stringify({
            tool_use_id: "tc-read",
            content: fileContent,
            detailedContent: "Read 3 lines from src/app.ts",
        }),
        metadata: null, createdAt: new Date().toISOString(),
    };
    api.handle("conversations.getMessages", () => ({ messages: [call, result], hasMore: false }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);
    await page.locator(".conversation-inner .tc .tc__header").click();

    // ReadView should show actual file lines, not the detailedContent summary
    await expect(page.locator(".rv__content").first()).toContainText("line 1", { timeout: 3_000 });
    // Summary text must NOT appear
    await expect(page.locator(".task-detail")).not.toContainText("Read 3 lines");
});
