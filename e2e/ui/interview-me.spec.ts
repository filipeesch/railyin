/**
 * interview-me.spec.ts — UI tests for the DecisionRequest component and Decisions tab.
 *
 * T-A: Render exclusive question, select option, submit enabled
 * T-B: Render non_exclusive question, check a checkbox, submit enabled
 * T-C: Freetext question, type answer, submit enabled
 * T-D: Multi-question batch — all must be answered before submit
 * T-E: Submit sends message to the task
 * T-F: Already-answered interview shows read-only state
 * T-G: Interview prompt followed by streaming — answered detection
 * T-H: Decisions tab button visible in task toolbar
 * T-I: Decisions tab loads DecisionsPanel, calls decisions.list
 * T-J: Full streaming flow — decision_request_prompt appears after done event via refreshLatestPage
 * T-K: message.new push event delivers decision_request_prompt when stream is already done
 *
 * Backend is fully mocked. interview_prompt messages are seeded via
 * `conversations.getMessages` returning ConversationMessage objects
 * with type: "decision_request_prompt" and JSON-stringified payload as content.
 */

import { test, expect } from "./fixtures";
import { makeUserMessage } from "./fixtures/mock-data";
import type { ConversationMessage } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _msgId = 5000;

function messagePage(messages: ConversationMessage[]) {
    return { messages, hasMore: false };
}

function makeInterviewPrompt(
    taskId: number,
    payload: { questions: object[]; context?: string },
    overrides?: Partial<ConversationMessage>,
): ConversationMessage {
    return {
        id: _msgId++,
        taskId,
        conversationId: taskId,
        type: "decision_request_prompt",
        role: "assistant",
        content: JSON.stringify(payload),
        metadata: null,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

const exclusiveQuestion = {
    question: "Which database do you prefer?",
    type: "exclusive",
    weight: "critical",
    options: [
        { title: "PostgreSQL", description: "Relational, battle-tested" },
        { title: "SQLite", description: "Lightweight, embedded" },
        { title: "MongoDB", description: "Document store" },
    ],
};

const nonExclusiveQuestion = {
    question: "Which features do you need?",
    type: "non_exclusive",
    weight: "medium",
    options: [
        { title: "Auth", description: "Authentication support" },
        { title: "Realtime", description: "WebSocket support" },
        { title: "Analytics", description: "Usage analytics" },
    ],
};

const freetextQuestion = {
    question: "Describe your use case.",
    type: "freetext",
    weight: "easy",
};

// ─── T-A: Exclusive question — select option → submit enabled ─────────────────

test.describe("T-A — exclusive question submit", () => {
    test("T-A: selecting an option in exclusive question enables submit", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__submit");
        await expect(submit).toBeVisible();
        await expect(submit).toBeDisabled();

        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).click();

        await expect(submit).toBeEnabled();
    });
});

// ─── T-B: Non-exclusive question — check checkbox → submit enabled ────────────

test.describe("T-B — non_exclusive question submit", () => {
    test("T-B: clicking checkbox enables submit", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [nonExclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__submit");
        await expect(submit).toBeVisible();
        await expect(submit).toBeDisabled();

        await page.locator(".interview__option").filter({ hasText: "Auth" }).locator(".interview__checkbox").click();

        await expect(submit).toBeEnabled();
    });

    test("T-B2: clicking checkbox directly also enables submit", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [nonExclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__submit");
        await expect(submit).toBeDisabled();

        await page.locator(".interview__option").filter({ hasText: "Realtime" }).locator(".interview__checkbox").click();

        await expect(submit).toBeEnabled();
    });

    test("T-B3: clicking a row in non_exclusive shows description preview but does NOT toggle checkbox", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [nonExclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__submit");
        await expect(submit).toBeDisabled();

        // Click the row (not the checkbox) — should only show preview
        await page.locator(".interview__option").filter({ hasText: "Auth" }).click();

        // Preview panel should appear
        await expect(page.locator(".interview__desc-panel")).toBeVisible();
        // But submit should remain disabled — no checkbox was checked
        await expect(submit).toBeDisabled();
    });

    test("T-B4: clicking a row then clicking its checkbox in non_exclusive enables submit", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [nonExclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__submit");
        const row = page.locator(".interview__option").filter({ hasText: "Auth" });

        // Row click focuses preview but does not select
        await row.click();
        await expect(page.locator(".interview__desc-panel")).toBeVisible();
        await expect(submit).toBeDisabled();

        // Checkbox click selects the option → submit enabled
        await row.locator(".interview__checkbox").click();
        await expect(submit).toBeEnabled();
    });
});

// ─── T-C: Freetext question — type answer → submit enabled ────────────────────

test.describe("T-C — freetext question submit", () => {
    test("T-C: typing in freetext textarea enables submit", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [freetextQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__submit");
        await expect(submit).toBeVisible();
        await expect(submit).toBeDisabled();

        await page.locator(".interview__textarea--freetext").fill("I am building a task management tool.");

        await expect(submit).toBeEnabled();
    });

    test("T-C2: clearing freetext after typing disables submit again", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [freetextQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__submit");
        const textarea = page.locator(".interview__textarea--freetext");

        await textarea.fill("Some text");
        await expect(submit).toBeEnabled();

        await textarea.fill("");
        await expect(submit).toBeDisabled();
    });
});

// ─── T-D: Multi-question — all must be answered before submit ────────────────

test.describe("T-D — multi-question batch", () => {
    test("T-D: submit disabled until all questions are answered", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, {
            questions: [exclusiveQuestion, freetextQuestion],
        });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__submit");
        await expect(submit).toBeDisabled();

        // Answer only the first question
        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).first().click();
        await expect(submit).toBeDisabled();

        // Answer the second question
        await page.locator(".interview__textarea--freetext").fill("My answer to question 2");
        await expect(submit).toBeEnabled();
    });
});

// ─── T-E: Submit sends message to the task ───────────────────────────────────

test.describe("T-E — submit sends message", () => {
    test("T-E: clicking submit calls tasks.sendMessage with answer", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        let sentBody: unknown;
        const replyMsg = makeUserMessage(task.id, "A: PostgreSQL");
        api.handle("tasks.sendMessage", (body) => {
            sentBody = body;
            return { message: replyMsg, executionId: 9999 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).click();
        await page.locator(".interview__submit").click();

        // Verify the message was sent with a non-empty answer
        await expect.poll(() => sentBody).toBeTruthy();
        const body = sentBody as { taskId: number; content: string };
        expect(body.content).toContain("PostgreSQL");
    });
});

// ─── T-F: Already-answered interview shows read-only state ───────────────────

test.describe("T-F — answered read-only state", () => {
    test("T-F: interview prompt followed by user message renders in read-only mode", async ({ page, api, task }) => {
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        // id must be greater than promptMsg.id so sort order is preserved (prompt first, reply second)
        const userReply = makeUserMessage(task.id, "A: PostgreSQL", { id: promptMsg.id + 1 });
        api.handle("conversations.getMessages", () => messagePage([promptMsg, userReply]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Should show the answered read-only view, not the interactive form
        await expect(page.locator(".interview--answered")).toBeVisible();
        await expect(page.locator(".interview__submit")).not.toBeVisible();
    });
});

// ─── T-G: Interview prompt followed by streaming — answered detection ─────────

test.describe("T-G — answered detection with streaming", () => {
    test("T-G: interview prompt is read-only after assistant starts streaming", async ({ page, api, ws, task }) => {
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        // id must be greater than promptMsg.id so sort order is preserved (prompt first, reply second)
        const userReply = makeUserMessage(task.id, "A: SQLite", { id: promptMsg.id + 1 });
        // Pre-seed: the interview was answered before we open the drawer
        api.handle("conversations.getMessages", () => messagePage([promptMsg, userReply]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Verify read-only
        await expect(page.locator(".interview--answered")).toBeVisible();

        // Push a streaming event — should not un-answer the interview
        ws.pushStreamEvent({
            taskId: task.id,
            executionId: 9001,
            seq: 0,
            blockId: "9001-text",
            type: "text_chunk",
            content: "Proceeding with SQLite...",
            metadata: null,
            parentBlockId: null,
            subagentId: null,
            done: false,
        });

        // Still read-only
        await expect(page.locator(".interview--answered")).toBeVisible();
        await expect(page.locator(".interview__submit")).not.toBeVisible();
    });
});

// ─── T-H: Decisions tab button visible in task toolbar ───────────────────────

test.describe("T-H — Decisions tab button visibility", () => {
    test("T-H: Decisions tab button is visible when a task drawer is open", async ({ page, api, task }) => {
        api.handle("conversations.getMessages", () => messagePage([]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // The Decisions tab button must be visible in the toolbar
        const decisionsTab = page.locator(".tab-switcher button", { hasText: "Decisions" });
        await expect(decisionsTab).toBeVisible();
    });

    test("T-H2: All three tab buttons (Chat, Info, Decisions) are visible", async ({ page, api, task }) => {
        api.handle("conversations.getMessages", () => messagePage([]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".tab-switcher button", { hasText: "Chat" })).toBeVisible();
        await expect(page.locator(".tab-switcher button", { hasText: "Info" })).toBeVisible();
        await expect(page.locator(".tab-switcher button", { hasText: "Decisions" })).toBeVisible();
    });
});

// ─── T-I: Decisions tab loads DecisionsPanel and calls decisions.list ─────────

test.describe("T-I — Decisions tab panel", () => {
    test("T-I: clicking Decisions tab shows empty state when no decisions exist", async ({ page, api, task }) => {
        api.handle("conversations.getMessages", () => messagePage([]));
        const decisionsListCalls: unknown[] = [];
        api.handle("decisions.list", (params) => {
            decisionsListCalls.push(params);
            return [];
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".tab-switcher button", { hasText: "Decisions" }).click();

        // Panel should show empty state
        await expect(page.locator(".decisions-panel")).toBeVisible();
        await expect(page.locator(".decisions-empty")).toBeVisible();

        // decisions.list should have been called with the task's conversationId
        await expect.poll(() => decisionsListCalls.length).toBeGreaterThan(0);
        expect((decisionsListCalls[0] as { conversationId: number }).conversationId).toBe(task.conversationId);
    });

    test("T-I2: clicking Decisions tab shows recorded decisions", async ({ page, api, task }) => {
        api.handle("conversations.getMessages", () => messagePage([]));
        api.handle("decisions.list", () => [
            {
                id: 1,
                conversationId: task.conversationId,
                batchId: null,
                question: "Which database?",
                answer: "SQLite",
                weight: "critical",
                notes: null,
                revisionCount: 0,
                isSourceAi: true,
                isDeleted: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".tab-switcher button", { hasText: "Decisions" }).click();

        await expect(page.locator(".decision-item")).toBeVisible();
        await expect(page.locator(".decision-item")).toContainText("Which database?");
        await expect(page.locator(".decision-item")).toContainText("SQLite");
    });
});

// ─── T-J: Full streaming flow — decision_request_prompt via refreshLatestPage ─

test.describe("T-J — streaming flow renders decision_request_prompt", () => {
    test("T-J: decision_request_prompt appears after done event triggers refreshLatestPage", async ({ page, api, ws, task }) => {
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });

        // Initially empty — no prompt seeded
        let servePrompt = false;
        api.handle("conversations.getMessages", () =>
            messagePage(servePrompt ? [promptMsg] : []),
        );

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // No form yet
        await expect(page.locator(".interview__submit")).not.toBeVisible();

        // Simulate: agent sends tool_call stream event for decision_request
        ws.pushStreamEvent({
            taskId: task.id,
            executionId: 7001,
            seq: 1,
            blockId: "7001-tc",
            type: "tool_call",
            content: JSON.stringify({ name: "decision_request", display: { label: "decision request" } }),
            metadata: null,
            parentBlockId: null,
            subagentId: null,
            done: false,
        });

        // Now update the API to include the prompt (simulating DB write that happened on backend)
        servePrompt = true;

        // Push the done event — this triggers refreshLatestPage in conversation store
        ws.pushDone(task.id, 7001);

        // The form should now appear (via refreshLatestPage fetching the prompt from API)
        await expect(page.locator(".interview__submit")).toBeVisible({ timeout: 5000 });
        await expect(page.locator(".interview__submit")).toBeDisabled();
    });

    test("T-J2: decision_request_prompt is interactive — can select option and submit", async ({ page, api, ws, task }) => {
        const promptId = 6000;
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] }, { id: promptId });
        const replyMsg = makeUserMessage(task.id, "A: SQLite", { id: promptId + 1 });

        let serveMessages: ConversationMessage[] = [];
        api.handle("conversations.getMessages", () => messagePage(serveMessages));
        api.handle("tasks.sendMessage", () => ({ message: replyMsg, executionId: 9999 }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the streaming flow to make the prompt appear
        serveMessages = [promptMsg];
        ws.pushDone(task.id, 7002);

        await expect(page.locator(".interview__submit")).toBeVisible({ timeout: 5000 });

        // Select an option and submit
        await page.locator(".interview__option").filter({ hasText: "SQLite" }).click();
        await expect(page.locator(".interview__submit")).toBeEnabled();

        // Update the messages to include the user reply (simulates what the backend would do)
        serveMessages = [promptMsg, replyMsg];
        await page.locator(".interview__submit").click();

        // Push the reply via WS so conversation re-renders in answered state
        ws.pushNewMessage(replyMsg);

        // After submit + user message arrives, form should show answered (read-only) state
        await expect(page.locator(".interview--answered")).toBeVisible({ timeout: 5000 });
    });
});

// ─── T-K: message.new push delivers decision_request_prompt when stream done ──

test.describe("T-K — message.new push event", () => {
    test("T-K: message.new with decision_request_prompt renders form (no active stream)", async ({ page, api, ws, task }) => {
        const promptMsg = makeInterviewPrompt(task.id, { questions: [freetextQuestion] });

        api.handle("conversations.getMessages", () => messagePage([]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // No form yet
        await expect(page.locator(".interview__submit")).not.toBeVisible();

        // Push message.new directly — simulates server broadcasting a persisted message
        // when there is no active stream (isDone guard should not block this)
        ws.pushNewMessage(promptMsg);

        await expect(page.locator(".interview__submit")).toBeVisible({ timeout: 5000 });
    });
});
