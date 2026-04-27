/**
 * interview-me.spec.ts — UI tests for the InterviewMe component.
 *
 * T-A: Render exclusive question, select option, submit enabled
 * T-B: Render non_exclusive question, check a checkbox, submit enabled
 * T-C: Freetext question, type answer, submit enabled
 * T-D: Multi-question batch — all must be answered before submit
 * T-E: Submit sends message to the task
 * T-F: Already-answered interview shows read-only state
 * T-G: Interview prompt followed by streaming — answered detection
 *
 * Backend is fully mocked. interview_prompt messages are seeded via
 * `conversations.getMessages` returning ConversationMessage objects
 * with type: "interview_prompt" and JSON-stringified payload as content.
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
): ConversationMessage {
    return {
        id: _msgId++,
        taskId,
        conversationId: taskId,
        type: "interview_prompt",
        role: "assistant",
        content: JSON.stringify(payload),
        metadata: null,
        createdAt: new Date().toISOString(),
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
    test("T-B: checking a checkbox in non_exclusive question enables submit", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [nonExclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__submit");
        await expect(submit).toBeVisible();
        await expect(submit).toBeDisabled();

        // Click the row (which now toggles the checkbox via onRowClick fix)
        await page.locator(".interview__option").filter({ hasText: "Auth" }).click();

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
