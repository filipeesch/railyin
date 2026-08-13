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

import { test as base, expect, openSessionDrawer } from "./fixtures";
import { makeChatSession, makeTask, makeUserMessage } from "./fixtures/mock-data";
import type { ConversationMessage, Task } from "@shared/rpc-types";

// Interview specs model a task AWAITING the interview by default — the
// corrected gating + stale rule hide the panel unless the task/session is
// `waiting_user`. Tests that need other states override `tasks.list` explicitly.
const test = base.extend<{ task: Task }>({
    task: async ({}, use) => {
        await use(waitingTask(100));
    },
});

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

/** A task in the awaiting-input state — required for pending-interview specs
 * (the corrected gating + stale rule hide the panel unless the task/session is
 * waiting on the interview). */
function waitingTask(id: number): Task {
    return makeTask({ id, executionState: "waiting_user" });
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

        const submit = page.locator(".interview__primary");
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

        const submit = page.locator(".interview__primary");
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

        const submit = page.locator(".interview__primary");
        await expect(submit).toBeDisabled();

        await page.locator(".interview__option").filter({ hasText: "Realtime" }).locator(".interview__checkbox").click();

        await expect(submit).toBeEnabled();
    });

    test("T-B3: clicking a row in non_exclusive shows description preview but does NOT toggle checkbox", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [nonExclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__primary");
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

        const submit = page.locator(".interview__primary");
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

        const submit = page.locator(".interview__primary");
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

        const submit = page.locator(".interview__primary");
        const textarea = page.locator(".interview__textarea--freetext");

        await textarea.fill("Some text");
        await expect(submit).toBeEnabled();

        await textarea.fill("");
        await expect(submit).toBeDisabled();
    });
});

// ─── T-D: Multi-question — all must be answered before submit ────────────────

test.describe("T-D — multi-question batch (paginated)", () => {
    test("T-D: primary action is Next on non-last pages, Submit on the last page", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, {
            questions: [exclusiveQuestion, freetextQuestion],
        });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const primary = page.locator(".interview__primary");
        await expect(primary).toHaveText("Next");
        await expect(primary).toBeDisabled();

        // Page 1 is the exclusive question — answering enables Next (primary).
        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).first().click();
        await expect(primary).toBeEnabled();

        // Advance to page 2 (freetext).
        await primary.click();
        await expect(page.locator(".interview__textarea--freetext")).toBeVisible();
        // On the last page the primary action is Submit, disabled until answered.
        await expect(primary).toHaveText("Submit");
        await expect(primary).toBeDisabled();

        // Answer the second question
        await page.locator(".interview__textarea--freetext").fill("My answer to question 2");
        await expect(primary).toBeEnabled();
    });

    test("T-D2: Back returns to previous page preserving answers", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, {
            questions: [exclusiveQuestion, freetextQuestion],
        });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Answer page 1, go to page 2, come back.
        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).first().click();
        await page.locator(".interview__primary").click();
        await page.locator(".interview__back").click();

        // The option selected on page 1 is preserved.
        await expect(page.locator(".interview__option--selected").filter({ hasText: "PostgreSQL" })).toBeVisible();
    });

    test("T-D3: question counter shows current page / total", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, {
            questions: [exclusiveQuestion, freetextQuestion],
        });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".interview__counter")).toHaveText("1 / 2");
        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).first().click();
        await page.locator(".interview__primary").click();
        await expect(page.locator(".interview__counter")).toHaveText("2 / 2");
    });

    test("T-D4: dismiss button closes the panel without submitting", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".decision-interview-panel")).toBeVisible();
        await page.locator(".decision-interview-panel__dismiss").click();
        await expect(page.locator(".decision-interview-panel")).not.toBeVisible();
    });

    test("T-D5: resize handle adjusts panel height; double-click resets it", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        api.handle("tasks.list", () => [waitingTask(task.id)]);
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const panel = page.locator(".decision-interview-panel");
        const body = page.locator(".decision-interview-panel__body");
        await expect(panel).toBeVisible();

        const initialHeight = await body.evaluate((el) => el.getBoundingClientRect().height);

        // The grip sits on the panel's TOP edge; the bottom is fixed in the
        // drawer flow. Drag UP → panel grows. The drawer may extend past the
        // right viewport edge, so clamp the click X into the visible area.
        const handle = page.locator(".decision-interview-panel__resize");
        const handleBox = await handle.boundingBox();
        const startX = Math.min(handleBox!.x + handleBox!.width / 2, 1270);
        const startY = handleBox!.y + handleBox!.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX, startY - 120, { steps: 5 });
        await page.mouse.up();

        const grownHeight = await body.evaluate((el) => el.getBoundingClientRect().height);
        expect(grownHeight).toBeGreaterThan(initialHeight);

        // Drag DOWN from the grown position → panel shrinks back.
        await page.mouse.move(startX, startY - 120);
        await page.mouse.down();
        await page.mouse.move(startX, startY, { steps: 5 });
        await page.mouse.up();

        const shrunkHeight = await body.evaluate((el) => el.getBoundingClientRect().height);
        expect(shrunkHeight).toBeLessThan(grownHeight);

        // Double-click resets to the default height.
        await handle.dblclick({ position: { x: Math.min(handleBox!.width / 2, 1270 - handleBox!.x), y: handleBox!.height / 2 } });
        const resetHeight = await body.evaluate((el) => el.getBoundingClientRect().height);
        expect(resetHeight).toBeLessThan(grownHeight);
    });

    test("T-D6: oversized question content scrolls while the footer stays fixed", async ({ page, api, task }) => {
        // A single tall question (long context + notes textarea) overflows the
        // fixed panel body height, so only the question content must scroll.
        const tallQuestion = {
            question: "Describe your complete architecture in detail?",
            type: "freetext" as const,
            context: Array.from({ length: 30 }, (_, i) => `Context paragraph ${i + 1} with some explanatory detail.`).join(" "),
        };
        const msg = makeInterviewPrompt(task.id, { questions: [tallQuestion] });
        api.handle("tasks.list", () => [waitingTask(task.id)]);
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const content = page.locator(".interview__content");
        const footer = page.locator(".interview__footer");
        await expect(content).toBeVisible();
        await expect(footer).toBeVisible();

        // Only the question content area is scrollable (scrollHeight > clientHeight).
        await expect
            .poll(async () => content.evaluate((el) => el.scrollHeight > el.clientHeight))
            .toBe(true);

        // Scroll the content to the bottom — the footer stays fixed/visible.
        await content.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await expect(footer).toBeVisible();
        await expect(page.locator(".interview__primary")).toBeVisible();
    });
});

// ─── T-E: Submit sends message to the task ───────────────────────────────────

test.describe("T-E — submit sends message", () => {
    test("T-E: clicking submit calls tasks.submitDecisions with answer", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        let sentBody: unknown;
        const replyMsg = makeUserMessage(task.id, "A: PostgreSQL");
        api.handle("tasks.submitDecisions", (body) => {
            sentBody = body;
            return { message: replyMsg, executionId: 9999 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).click();
        await page.locator(".interview__primary").click();

        // Verify answers were sent with the selected option title
        await expect.poll(() => sentBody).toBeTruthy();
        const body = sentBody as { taskId: number; answers: Array<{ answer: string }> };
        expect(body.answers[0].answer).toContain("PostgreSQL");
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
        await expect(page.locator(".interview")).not.toBeVisible();
        await expect(page.locator(".interview__primary")).not.toBeVisible();
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

        // Verify read-only — form hidden because answered
        await expect(page.locator(".interview")).not.toBeVisible();

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

        // Still read-only — form still hidden after streaming event
        await expect(page.locator(".interview")).not.toBeVisible();
        await expect(page.locator(".interview__primary")).not.toBeVisible();
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

// ─── T-J: Full streaming flow — pages stream live, terminal persists ─────────

test.describe("T-J — streaming flow renders pages live + persisted prompt", () => {
    test("T-J: decision_request_page events stream pages into the panel before done", async ({ page, api, ws, task }) => {
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });

        // Task starts RUNNING (model streaming the interview).
        api.handle("tasks.list", () => [makeTask({ id: task.id, executionState: "running" })]);

        // Initially empty — no prompt seeded
        let servePrompt = false;
        api.handle("conversations.getMessages", () =>
            messagePage(servePrompt ? [promptMsg] : []),
        );

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // No form yet
        await expect(page.locator(".interview__primary")).not.toBeVisible();

        // Agent streams a decision_request_page event while still running.
        ws.pushDecisionRequestPage(task.id, 7001, exclusiveQuestion);

        // The page streams live into the fixed panel BEFORE done.
        await expect(page.locator(".decision-interview-panel .interview__question-text")).toContainText("Which database do you prefer?", { timeout: 5000 });

        // Submit stays disabled while running EVEN with all answers filled (D2 gate).
        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).click();
        await expect(page.locator(".interview__primary")).toBeDisabled();

        // Turn ends: backend persists the prompt AND the task transitions to waiting_user.
        servePrompt = true;
        ws.pushDone(task.id, 7001);
        ws.push({ type: "task.updated", payload: makeTask({ id: task.id, executionState: "waiting_user" }) });

        // Panel reconciles to the persisted payload; Submit becomes enabled.
        await expect(page.locator(".interview__primary")).toBeEnabled({ timeout: 5000 });
    });

    test("T-J2: persisted decision_request_prompt is interactive — select option and submit", async ({ page, api, ws, task }) => {
        const promptId = 6000;
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] }, { id: promptId });
        const replyMsg = makeUserMessage(task.id, "A: SQLite", { id: promptId + 1 });

        let serveMessages: ConversationMessage[] = [];
        api.handle("conversations.getMessages", () => messagePage(serveMessages));
        api.handle("tasks.submitDecisions", () => ({ message: replyMsg, executionId: 9999 }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Persisted prompt arrives via done + refreshLatestPage.
        serveMessages = [promptMsg];
        ws.pushDone(task.id, 7002);

        await expect(page.locator(".interview__primary")).toBeVisible({ timeout: 5000 });

        // Select an option and submit
        await page.locator(".interview__option").filter({ hasText: "SQLite" }).click();
        await expect(page.locator(".interview__primary")).toBeEnabled();

        // Update the messages to include the user reply (simulates what the backend would do)
        serveMessages = [promptMsg, replyMsg];
        await page.locator(".interview__primary").click();

        // Push the reply via WS so conversation re-renders in answered state
        ws.pushNewMessage(replyMsg);

        // After submit + user message arrives, the whole panel should close
        // (answered state → showPanel returns false).
        await expect(page.locator(".decision-interview-panel")).not.toBeVisible({ timeout: 5000 });
    });
});

// ─── T-W: a SECOND interview wave must replace the first after answering ──────

test.describe("T-W — second interview wave replaces the first", () => {
    test("T-W: after answering wave 1, the panel shows wave 2's questions (never wave 1 again)", async ({ page, api, ws, task }) => {
        const wave1Prompt = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] }, { id: 6100 });
        const wave2Prompt = makeInterviewPrompt(
            task.id,
            { questions: [{ question: "Second wave question?", type: "freetext", weight: "easy" }] },
            { id: 6200 },
        );
        const replyMsg = makeUserMessage(task.id, "A: PostgreSQL", { id: 6101 });

        let serveMessages: ConversationMessage[] = [wave1Prompt];
        api.handle("conversations.getMessages", () => messagePage(serveMessages));
        api.handle("tasks.submitDecisions", () => ({ message: replyMsg, executionId: 9999 }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Wave 1 is showing.
        await expect(page.locator(".decision-interview-panel .interview__question-text")).toContainText("Which database do you prefer?", { timeout: 5000 });

        // Answer wave 1 and submit → panel closes.
        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).click();
        await page.locator(".interview__primary").click();
        ws.pushNewMessage(replyMsg);
        await expect(page.locator(".decision-interview-panel")).not.toBeVisible({ timeout: 5000 });

        // The model sends a SECOND wave: new terminal prompt persisted server-side.
        serveMessages = [wave1Prompt, replyMsg, wave2Prompt];
        ws.pushNewMessage(wave2Prompt);

        // The panel must show WAVE 2 — never wave 1 again.
        await expect(page.locator(".decision-interview-panel .interview__question-text")).toContainText("Second wave question?", { timeout: 5000 });
        await expect(page.locator(".decision-interview-panel")).not.toContainText("Which database do you prefer?");
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
        await expect(page.locator(".interview__primary")).not.toBeVisible();

        // Push message.new directly — simulates server broadcasting a persisted message
        // when there is no active stream (isDone guard should not block this)
        ws.pushNewMessage(promptMsg);

        await expect(page.locator(".decision-interview-panel .interview__primary")).toBeVisible({ timeout: 5000 });
    });
});

// ─── T-L: General notes textarea is always visible ───────────────────────────

test.describe("T-L — general notes textarea visibility", () => {
    test("T-L: general notes textarea is visible in a decision form", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".interview__general-notes")).toBeVisible();
    });

    test("T-L2: general notes textarea is visible even before selecting an answer", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [freetextQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".interview__general-notes")).toBeVisible();
    });
});

// ─── T-M: General notes are included in submitDecisions payload ───────────────

test.describe("T-M — general notes in submission payload", () => {
    test("T-M: general notes typed in textarea are sent in submitDecisions request", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [freetextQuestion] });
        const replyMsg = makeUserMessage(task.id, "Test reply");

        let capturedBody: { answers: Array<{ question: string; answer: string }>; generalNotes?: string } | null = null;
        api.handle("conversations.getMessages", () => messagePage([msg]));
        api.handle("tasks.submitDecisions", (body) => {
            capturedBody = body as typeof capturedBody;
            return { message: replyMsg, executionId: 1 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Fill in freetext answer
        await page.locator(".interview__textarea--freetext").fill("My use case is building a CLI tool.");
        // Fill in general notes
        await page.locator(".interview__textarea--notes").fill("These are overarching notes.");

        await page.locator(".interview__primary").click();

        expect(capturedBody).not.toBeNull();
        expect(capturedBody!.generalNotes).toBe("These are overarching notes.");
    });
});

// ─── T-N: Empty general notes are not sent in payload ────────────────────────

test.describe("T-N — empty general notes omitted", () => {
    test("T-N: generalNotes is undefined when textarea is left empty", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [freetextQuestion] });
        const replyMsg = makeUserMessage(task.id, "Test reply");

        let capturedBody: { answers: Array<{ question: string; answer: string }>; generalNotes?: string } | null = null;
        api.handle("conversations.getMessages", () => messagePage([msg]));
        api.handle("tasks.submitDecisions", (body) => {
            capturedBody = body as typeof capturedBody;
            return { message: replyMsg, executionId: 1 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".interview__textarea--freetext").fill("My use case.");
        // Do NOT fill general notes — leave empty

        await page.locator(".interview__primary").click();

        expect(capturedBody).not.toBeNull();
        expect(capturedBody!.generalNotes).toBeUndefined();
    });
});

// ─── T-O: Submit calls tasks.submitDecisions (not sendMessage) ───────────────

test.describe("T-O — submitDecisions endpoint used on submit", () => {
    test("T-O: submit button calls tasks.submitDecisions endpoint", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        const replyMsg = makeUserMessage(task.id, "Answered");

        let submitDecisionsCalled = false;
        api.handle("conversations.getMessages", () => messagePage([msg]));
        api.handle("tasks.submitDecisions", () => {
            submitDecisionsCalled = true;
            return { message: replyMsg, executionId: 1 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".interview__option").filter({ hasText: "SQLite" }).click();
        await page.locator(".interview__primary").click();

        expect(submitDecisionsCalled).toBe(true);
    });
});

// ─── T-P: "Record as decisions" toggle ──────────────────────────────────────

test.describe("T-P — Record as decisions toggle", () => {
    test("T-P1: toggle is visible and checked by default", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const toggle = page.locator(".interview__record-toggle");
        await expect(toggle).toBeVisible();
        await expect(toggle.locator("input")).toBeChecked();
    });

    test("T-P2: unchecking toggle and submitting sends recordAsDecisions=false", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        const replyMsg = makeUserMessage(task.id, "A: PostgreSQL");
        api.handle("conversations.getMessages", () => messagePage([msg]));

        let capturedBody: { recordAsDecisions?: boolean } | null = null;
        api.handle("tasks.submitDecisions", (body) => {
            capturedBody = body as typeof capturedBody;
            return { message: replyMsg, executionId: 9999 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).click();

        // Uncheck the toggle
        await page.locator(".interview__record-toggle input").uncheck();

        await page.locator(".interview__primary").click();

        await expect.poll(() => capturedBody).toBeTruthy();
        expect(capturedBody!.recordAsDecisions).toBe(false);
    });

    test("T-P3: leaving toggle checked and submitting sends recordAsDecisions=true", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        const replyMsg = makeUserMessage(task.id, "A: PostgreSQL");
        api.handle("conversations.getMessages", () => messagePage([msg]));

        let capturedBody: { recordAsDecisions?: boolean } | null = null;
        api.handle("tasks.submitDecisions", (body) => {
            capturedBody = body as typeof capturedBody;
            return { message: replyMsg, executionId: 9999 };
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".interview__option").filter({ hasText: "PostgreSQL" }).click();
        await page.locator(".interview__primary").click();

        await expect.poll(() => capturedBody).toBeTruthy();
        expect(capturedBody!.recordAsDecisions).toBe(true);
    });

    test("T-Q3: toggle is visible regardless of question type", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [freetextQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".interview__record-toggle")).toBeVisible();
    });
});

// ─── T-Q: Multiselect "Other" textarea visibility ───────────────────────────

test.describe("T-Q — multiselect Other textarea", () => {
    test("T-Q1: clicking Other checkbox directly shows Other textarea and enables submit when filled", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [nonExclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__primary");
        await expect(submit).toBeDisabled();

        // Click the "Other" checkbox directly (not the row) — @click.stop prevents focus change
        await page.locator(".interview__option").filter({ hasText: "Other" }).locator(".interview__checkbox").click();

        // The Other textarea should be visible even though the row wasn't clicked
        const otherTextarea = page.locator(".interview__textarea--other");
        await expect(otherTextarea).toBeVisible();
        await expect(submit).toBeDisabled();

        // Fill the Other textarea → submit becomes enabled
        await otherTextarea.fill("Custom feature");
        await expect(submit).toBeEnabled();
    });

    test("T-Q2: Other checked but text empty keeps submit disabled", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [nonExclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const submit = page.locator(".interview__primary");

        await page.locator(".interview__option").filter({ hasText: "Other" }).locator(".interview__checkbox").click();

        const otherTextarea = page.locator(".interview__textarea--other");
        await expect(otherTextarea).toBeVisible();

        // Empty text — submit stays disabled
        await expect(submit).toBeDisabled();
    });
});

// ─── T-K2: message.new prompt while the stream is still ACTIVE ───────────────

test.describe("T-K2 — message.new prompt mid-stream", () => {
    test("T-K2: decision_request_prompt pushed before done still renders (drop-guard exemption)", async ({ page, api, ws, task }) => {
        const promptMsg = makeInterviewPrompt(task.id, { questions: [freetextQuestion] }, { id: 6500 });

        // Task is running; no persisted prompt yet.
        api.handle("tasks.list", () => [makeTask({ id: task.id, executionState: "running" })]);
        api.handle("conversations.getMessages", () => messagePage([]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".interview__primary")).not.toBeVisible();

        // Stream a live page (creates an active, not-done stream state)…
        ws.pushDecisionRequestPage(task.id, 7101, freetextQuestion);

        // …then push the persisted terminal prompt BEFORE the done event: it
        // must be appended (drop-guard exemption) and the panel must render it.
        ws.pushNewMessage(promptMsg);

        await expect(page.locator(".decision-interview-panel .interview__primary")).toBeVisible({ timeout: 5000 });
    });
});

// ─── T-R: stale interview hides the panel ────────────────────────────────────

test.describe("T-R — stale interview hidden", () => {
    test("T-R: persisted prompt + completed task + no live pages → panel absent", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        api.handle("tasks.list", () => [makeTask({ id: task.id, executionState: "completed" })]);
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".decision-interview-panel")).not.toBeVisible();
    });
});

// ─── T-T: raced data (answer before prompt) hides the panel ──────────────────

test.describe("T-T — raced data hidden", () => {
    test("T-T: prompt persisted after the answer + task not waiting → panel absent", async ({ page, api, task }) => {
        const promptId = 6600;
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] }, { id: promptId });
        // The answer message predates the terminal prompt (early-submit race).
        const userMsg = makeUserMessage(task.id, "A: SQLite", { id: promptId - 1 });
        api.handle("tasks.list", () => [makeTask({ id: task.id, executionState: "completed" })]);
        api.handle("conversations.getMessages", () => messagePage([userMsg, promptMsg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".decision-interview-panel")).not.toBeVisible();
    });
});

// ─── T-S: dismissal persists per episode across drawer reopen ────────────────

test.describe("T-S — dismissal persists per episode", () => {
    test("T-S: dismissed interview stays hidden after drawer reopen; new episode shows again", async ({ page, api, ws, task }) => {
        const promptId = 6700;
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] }, { id: promptId });

        let messages: ConversationMessage[] = [promptMsg];
        api.handle("conversations.getMessages", () => messagePage(messages));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".decision-interview-panel")).toBeVisible();
        await page.locator(".decision-interview-panel__dismiss").click();
        await expect(page.locator(".decision-interview-panel")).not.toBeVisible();

        // Close the drawer (header ✕) and reopen — dismissal persists per episode.
        await page.locator(".tcv-header .pi-times").click();
        await expect(page.locator(".task-detail")).not.toBeVisible();
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".decision-interview-panel")).not.toBeVisible();

        // A NEW episode (new prompt id) clears the dismissal effect.
        messages = [promptMsg, makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] }, { id: promptId + 1 })];
        ws.pushNewMessage(messages[1]!);

        await expect(page.locator(".decision-interview-panel")).toBeVisible({ timeout: 5000 });
    });
});

// ─── T-U: no in-chat balloon ─────────────────────────────────────────────────

test.describe("T-U — no in-chat decision-request balloon", () => {
    test("T-U: answered interview renders no chat balloon", async ({ page, api, task }) => {
        const promptId = 6800;
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] }, { id: promptId });
        const replyMsg = makeUserMessage(task.id, "A: PostgreSQL", { id: promptId + 1 });
        api.handle("tasks.list", () => [makeTask({ id: task.id, executionState: "completed" })]);
        api.handle("conversations.getMessages", () => messagePage([promptMsg, replyMsg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".msg--interview-prompt")).toHaveCount(0);
    });

    test("T-U2: unanswered interview shows the panel but no chat balloon", async ({ page, api, task }) => {
        const msg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] });
        api.handle("conversations.getMessages", () => messagePage([msg]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".decision-interview-panel")).toBeVisible();
        await expect(page.locator(".msg--interview-prompt")).toHaveCount(0);
    });
});

// ─── T-V: session interview panel gating ─────────────────────────────────────

test.describe("T-V — session interview panel", () => {
    test("T-V: waiting_user session shows the panel; Submit enabled when answered", async ({ page, api }) => {
        const session = makeChatSession({ id: 700, title: "Interview Session", status: "waiting_user" });
        const promptMsg = makeInterviewPrompt(session.conversationId, { questions: [exclusiveQuestion] }, { id: 6900 });

        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        api.handle("conversations.getMessages", () => messagePage([promptMsg]));

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".decision-interview-panel")).toBeVisible({ timeout: 5000 });

        await page.locator(".interview__option").filter({ hasText: "SQLite" }).click();
        await expect(page.locator(".interview__primary")).toBeEnabled();
    });

    test("T-V2: idle session hides the panel (stale interview)", async ({ page, api }) => {
        const session = makeChatSession({ id: 701, title: "Done Session", status: "idle" });
        const promptMsg = makeInterviewPrompt(session.conversationId, { questions: [exclusiveQuestion] }, { id: 6950 });

        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        api.handle("conversations.getMessages", () => messagePage([promptMsg]));

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".decision-interview-panel")).not.toBeVisible();
    });
});
