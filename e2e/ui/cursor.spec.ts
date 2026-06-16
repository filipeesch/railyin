/**
 * cursor.spec.ts — UI tests for tasks running under the Cursor SDK engine.
 *
 * The chat surface is engine-agnostic: streaming, tool rendering, and
 * decision_request prompts come through engine-neutral RPC + WS events.
 * These tests prove the cursor model picks up, the streaming/tool/decision_request
 * paths render under a `cursor/...` model, and the model swap surface works.
 *
 * Suites:
 *   CU-1: model picker exposes the cursor engine and switches the task model
 *   CU-2: token streaming under cursor/* renders the assistant message
 *   CU-3: tool_call + tool_result render in the chat surface
 *   CU-4: decision_request_prompt renders the interview UI under cursor
 *
 * All backend traffic is mocked via ApiMock + WsMock.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, sendMessage } from "./fixtures";
import { makeUserMessage, makeAssistantMessage } from "./fixtures/mock-data";
import type { Task, StreamEvent, ConversationMessage } from "@shared/rpc-types";

const CURSOR_MODELS = [
    { id: "fake/test",                  displayName: "Fake/Test",        contextWindow: 8192,    engineId: "fake" },
    { id: "cursor/claude-sonnet-4-6",   displayName: "Claude Sonnet 4.6", contextWindow: 200_000, engineId: "cursor" },
    { id: "cursor/gpt-5",               displayName: "GPT-5",            contextWindow: 200_000, engineId: "cursor" },
];

const EXEC_ID = 9101;

function textChunk(taskId: number, seq: number, content: string, done = false, executionId = EXEC_ID): StreamEvent {
    return {
        taskId,
        conversationId: taskId,
        executionId,
        seq,
        blockId: `${executionId}-text`,
        type: "text_chunk",
        content,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done,
    };
}

function makeToolCallMessage(
    taskId: number,
    id: number,
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    resultContent: string,
): ConversationMessage[] {
    return [
        {
            id,
            taskId,
            conversationId: taskId,
            type: "tool_call",
            role: "assistant",
            content: JSON.stringify({
                type: "function",
                function: { name: toolName, arguments: JSON.stringify(args) },
                id: callId,
                display: { label: toolName, subject: args.path != null ? String(args.path) : undefined },
            }),
            metadata: null,
            createdAt: new Date().toISOString(),
        },
        {
            id: id + 1,
            taskId,
            conversationId: taskId,
            type: "tool_result",
            role: "user",
            content: JSON.stringify({ tool_use_id: callId, content: resultContent }),
            metadata: null,
            createdAt: new Date().toISOString(),
        },
    ];
}

function makeDecisionRequestPrompt(taskId: number, id = 7700): ConversationMessage {
    return {
        id,
        taskId,
        conversationId: taskId,
        type: "decision_request_prompt",
        role: "assistant",
        content: JSON.stringify({
            questions: [{
                question: "Pick a runtime for the cursor session",
                type: "exclusive",
                weight: "critical",
                options: [
                    { title: "Bun", description: "Default Railyin runtime" },
                    { title: "Node", description: "Used by the cursor worker subprocess" },
                ],
            }],
        }),
        metadata: null,
        createdAt: new Date().toISOString(),
    };
}

// ─── CU-1: Cursor engine model picker ─────────────────────────────────────────

test.describe("CU-1 — cursor model picker", () => {
    test("CU-1.1: model picker exposes cursor/* models", async ({ page, api, task }) => {
        api.returns("models.listEnabled", CURSOR_MODELS);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Open the model picker dropdown inside the task drawer
        await page.locator(".task-detail .input-model-select").first().click();
        await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });

        // Both cursor models should appear in the picker
        await expect(page.locator(".p-select-overlay .p-select-option", { hasText: "Claude Sonnet 4.6" })).toBeVisible();
        await expect(page.locator(".p-select-overlay .p-select-option", { hasText: "GPT-5" })).toBeVisible();

        // Multi-engine listing should show an engine group header for "cursor"
        const groupTexts = await page.locator(".p-select-overlay .model-select__group-header").allInnerTexts();
        expect(groupTexts).toContain("cursor");
    });

    test("CU-1.2: selecting a cursor model updates the task's model", async ({ page, api, ws, task }) => {
        api.returns("models.listEnabled", CURSOR_MODELS);

        const updated: Task = { ...task, model: "cursor/claude-sonnet-4-6" };
        api.handle("tasks.setModel", () => updated);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".task-detail .input-model-select").first().click();
        await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });
        await page.locator(".p-select-overlay .p-select-option", { hasText: "Claude Sonnet 4.6" }).click();

        // Backend confirms the swap via task.updated
        ws.push({ type: "task.updated", payload: updated });

        await expect(page.locator(".task-detail__model-row")).toContainText("Claude Sonnet 4.6", { timeout: 3_000 });
    });
});

// ─── CU-2: Token streaming under cursor ───────────────────────────────────────

test.describe("CU-2 — cursor token streaming", () => {
    test("CU-2.1: text_chunk events from a cursor-model task render in the chat surface", async ({ page, api, ws, task }) => {
        const cursorTask: Task = { ...task, model: "cursor/claude-sonnet-4-6" };
        api.returns("models.listEnabled", CURSOR_MODELS);
        api.handle("tasks.list", () => [cursorTask]);

        const assistantMsg = makeAssistantMessage(cursorTask.id, "Hello from cursor");
        api.handle("tasks.sendMessage", async () => {
            // Backend would route through CursorEngine; emit stream events here
            // as the cursor SDK worker would push them.
            setTimeout(() => {
                ws.pushStreamEvent(textChunk(cursorTask.id, 0, "Hello"));
                ws.pushStreamEvent(textChunk(cursorTask.id, 1, " from"));
                ws.pushStreamEvent(textChunk(cursorTask.id, 2, " cursor"));
                ws.pushDone(cursorTask.id, EXEC_ID);
            }, 50);
            return { message: makeUserMessage(cursorTask.id, "Hello cursor"), executionId: EXEC_ID };
        });
        api.handle("conversations.getMessages", () => ({ messages: [assistantMsg], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, cursorTask.id);
        await sendMessage(page, "Hello cursor");

        await expect(page.locator(".msg__bubble.streaming")).not.toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".msg--assistant").last()).toContainText("Hello from cursor");
    });
});

// ─── CU-3: Tool rendering under cursor ────────────────────────────────────────

test.describe("CU-3 — cursor tool rendering", () => {
    test("CU-3.1: tool_call + tool_result messages render under a cursor-model task", async ({ page, api, task }) => {
        const cursorTask: Task = { ...task, model: "cursor/claude-sonnet-4-6" };
        api.returns("models.listEnabled", CURSOR_MODELS);
        api.handle("tasks.list", () => [cursorTask]);

        const messages = makeToolCallMessage(
            cursorTask.id,
            200,
            "tc-railyin-shell-1",
            "railyin_shell",
            { command: "ls -la" },
            "exit_code: 0\n--- stdout ---\ntotal 0\n",
        );

        // Append a trailing assistant message so the timeline has a final response.
        const assistant = makeAssistantMessage(cursorTask.id, "Listing complete.", { id: 220 });
        api.handle("conversations.getMessages", () => ({
            messages: [...messages, assistant],
            hasMore: false,
        }));

        await page.goto("/");
        await openTaskDrawer(page, cursorTask.id);

        // The tool call group should render with the cursor bypass tool name visible.
        await expect(page.locator(".conversation-inner .tc").first()).toBeVisible({ timeout: 5_000 });
        await expect(page.locator(".tc__tool-name").first()).toContainText("railyin_shell");

        // The trailing assistant message should also render.
        await expect(page.locator(".msg--assistant").last()).toContainText("Listing complete.");
    });
});

// ─── CU-4: decision_request prompt under cursor ───────────────────────────────

test.describe("CU-4 — decision_request prompt under cursor", () => {
    test("CU-4.1: decision_request_prompt renders the interview UI for a cursor-model task", async ({ page, api, task }) => {
        const cursorTask: Task = { ...task, model: "cursor/claude-sonnet-4-6", executionState: "waiting_user" };
        api.returns("models.listEnabled", CURSOR_MODELS);
        api.handle("tasks.list", () => [cursorTask]);

        const promptMsg = makeDecisionRequestPrompt(cursorTask.id);
        api.handle("conversations.getMessages", () => ({ messages: [promptMsg], hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, cursorTask.id);

        // The decision_request UI surfaces the question + options.
        await expect(page.locator(".interview")).toBeVisible({ timeout: 5_000 });
        await expect(page.locator(".interview")).toContainText("Pick a runtime for the cursor session");
        await expect(page.locator(".interview__option").filter({ hasText: "Bun" })).toBeVisible();
        await expect(page.locator(".interview__option").filter({ hasText: "Node" })).toBeVisible();

        // Submit stays disabled until the user picks an option.
        await expect(page.locator(".interview__submit")).toBeDisabled();
        await page.locator(".interview__option").filter({ hasText: "Node" }).click();
        await expect(page.locator(".interview__submit")).toBeEnabled();
    });
});
