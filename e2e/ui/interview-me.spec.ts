/**
 * interview-me.spec.ts — UI tests for the DecisionInterrupt card and Decisions tab.
 *
 * T-A: Render exclusive question, select option, submit enabled
 * T-D: Multi-question batch — all must be answered before submit
 * T-E: Submit resumes the run with the selected answers
 * T-J: Full streaming flow — the interrupt outcome renders the decision card
 * T-K: Replayed interrupt renders the decision card with no active run
 * T-L: General notes textarea is always visible
 * T-M: General notes are included in the resume payload
 * T-N: Empty general notes are omitted from the resume payload
 * T-O: Submit sends answers through the resume payload (not submitDecisions)
 * T-P: "Record as decisions" toggle
 * T-F: Already-answered interview shows read-only state
 * T-G: Interview prompt followed by streaming — answered detection
 * T-H: Decisions tab button visible in task toolbar
 * T-I: Decisions tab loads DecisionsPanel, calls decisions.list
 *
 * Migrated onto the agui fixture (Phase 6, plan 06-05): the legacy
 * decision_request_prompt ws flow + tasks.submitDecisions RPC are gone —
 * decision intents now run through the canonical C-4/C-5 interrupt pattern
 * (agui.script = "interrupt" → [data-testid="decision-card"] + .di__option
 * rows → flip to "quick" before [data-testid="decision-submit"] →
 * agui.lastRunInput.resume payload assertions). Notes/recordAsDecisions map
 * to DecisionInterrupt's .di__general-notes textarea + .di__record-toggle
 * checkbox (verified DecisionInterrupt.vue:37-122). The 8 non_exclusive /
 * freetext / Other-surface tests are skipped-with-gap-note (A6): the mock-agui
 * interrupt script serves exclusive questions only, so exercising those
 * DecisionInterrupt surfaces needs a fixture payload knob — recorded in
 * 06-05-SUMMARY.md as a phase-gate decision. The 6 green Decisions-tab tests
 * (T-F/G, T-H/H2, T-I/I2) stayed byte-identical.
 *
 * Backend is fully mocked. The agui fixture's "interrupt" script streams the
 * canonical interrupt outcome (two exclusive questions).
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, submitChatMessage } from "./fixtures";
import { makeUserMessage } from "./fixtures/mock-data";
import type { ConversationMessage } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function messagePage(messages: ConversationMessage[]) {
    return { messages, hasMore: false };
}

/**
 * IN-03: explicit literal ids — the module-level auto-increment counter was
 * shared mutable state across every test in the file (any future
 * parallelization or reordering would silently shift ids). Callers MUST pass
 * a unique literal id; the reply message pins itself to promptMsg.id + 1 for
 * sort order, so per-test distinctness is guaranteed by the literals.
 */
function makeInterviewPrompt(
    taskId: number,
    payload: { questions: object[]; context?: string },
    overrides: Partial<ConversationMessage> & { id: number },
): ConversationMessage {
    return {
        id: overrides.id,
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

/** The resume payload type of the C-4 contract (event-bridge.ts:380-422). */
type ResumeEntry = {
    interruptId: string;
    status: string;
    payload?: {
        decision?: string;
        answers?: Array<{ question: string; answer: string; weight: string; notes?: string }>;
        generalNotes?: string;
        recordAsDecisions?: boolean;
    };
};

/** C-4 resume-payload helper: poll lastRunInput until the resume /run lands. */
async function expectResumeRan(page: import("@playwright/test").Page, agui: { lastRunInput: unknown }): Promise<ResumeEntry[]> {
    await expect
        .poll(() => (agui.lastRunInput as { resume?: unknown[] } | null)?.resume?.length ?? 0, { timeout: 10_000 })
        .toBeGreaterThan(0);
    return (agui.lastRunInput as { resume: ResumeEntry[] }).resume;
}

// ─── T-A: Exclusive question — select option → submit enabled ─────────────────

test.describe("T-A — exclusive question submit", () => {
    test("T-A: selecting options in the exclusive questions enables submit once all are answered", async ({ page, task, agui }) => {
        agui.script = "interrupt"; // the fixture streams the interrupt outcome

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await expect(decisionCard).toContainText("Should I apply the changes to src/auth.ts?");

        const submit = page.locator('[data-testid="decision-submit"]');
        await expect(submit).toBeDisabled();

        // Answering only the first question keeps submit disabled (the second
        // exclusive question is still unanswered).
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await expect(submit).toBeDisabled();

        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();
        await expect(submit).toBeEnabled();
    });
});

// ─── T-D: Multi-question — all must be answered before submit ────────────────

test.describe("T-D — multi-question batch", () => {
    test("T-D: submit stays disabled until all questions in the batch are answered", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });

        const submit = page.locator('[data-testid="decision-submit"]');
        await expect(submit).toBeDisabled();

        // Answer only the first question.
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await expect(submit).toBeDisabled();

        // Answer the second question — the batch is complete.
        await decisionCard.locator(".di__option", { hasText: "Graceful default" }).click();
        await expect(submit).toBeEnabled();
    });
});

// ─── T-E: Submit sends message to the task ───────────────────────────────────

test.describe("T-E — submit sends message", () => {
    test("T-E: clicking submit resumes the run with the selected answers", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();

        agui.script = "quick"; // the resume run completes normally
        await page.locator('[data-testid="decision-submit"]').click();

        // Resume payload contract (INVALID_PAYLOAD — event-bridge.ts:380-422).
        const resume = await expectResumeRan(page, agui);
        expect(resume[0].interruptId).toBe("decision-interrupt-1");
        expect(resume[0].status).toBe("resolved");
        expect(resume[0].payload?.answers?.length).toBeGreaterThan(0);
        expect(resume[0].payload?.answers?.[0]?.answer).toContain("Yes, apply them");
    });
});

// ─── T-J: Full streaming flow — interrupt outcome via the /run stream ────────

test.describe("T-J — streaming flow renders the decision card", () => {
    test("T-J: the decision card appears when the run finishes with the interrupt outcome", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Nothing has run — no card yet.
        await expect(page.locator('[data-testid="decision-card"]')).not.toBeVisible();

        await submitChatMessage(page, "interview me");

        // The interrupt outcome arrives with the run's terminal event.
        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await expect(decisionCard).toContainText("Should I apply the changes to src/auth.ts?");
        await expect(page.locator('[data-testid="decision-submit"]')).toBeDisabled();
    });

    test("T-J2: the decision card is interactive — select an option and submit", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await decisionCard.locator(".di__option", { hasText: "No, revise first" }).click();
        await decisionCard.locator(".di__option", { hasText: "Graceful default" }).click();
        await expect(page.locator('[data-testid="decision-submit"]')).toBeEnabled();

        agui.script = "quick";
        await page.locator('[data-testid="decision-submit"]').click();

        // After submit + resume run, the card disappears (resolved state).
        await expect(decisionCard).not.toBeVisible({ timeout: 10_000 });
        const resume = await expectResumeRan(page, agui);
        expect(resume[0].interruptId).toBe("decision-interrupt-1");
        expect(resume[0].payload?.answers?.length).toBeGreaterThan(0);
    });
});

// ─── T-K: Replayed interrupt delivers the prompt with no active run ──────────

test.describe("T-K — replay without an active run", () => {
    test("T-K: the decision card renders from the replayed interrupt when no run is active", async ({ page, task, agui }) => {
        agui.script = "interrupt";
        agui.registerThread(String(task.conversationId));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // No active /run — the connect replay re-pends the interrupt outcome
        // (IN-07 / D-08), delivering the decision prompt like a persisted
        // message.new would on the legacy stack.
        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await expect(decisionCard).toContainText("Should I apply the changes to src/auth.ts?");
    });
});

// ─── T-L: General notes textarea is always visible ───────────────────────────

test.describe("T-L — general notes textarea visibility", () => {
    test("T-L: the general notes textarea is visible in the decision card", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await expect(decisionCard.locator(".di__general-notes .di__textarea--notes")).toBeVisible();
    });

    test("T-L2: the general notes textarea is visible even before selecting an answer", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await expect(decisionCard.locator(".di__general-notes .di__textarea--notes")).toBeVisible();
    });
});

// ─── T-M: General notes are included in the resume payload ───────────────────

test.describe("T-M — general notes in the resume payload", () => {
    test("T-M: general notes typed in the textarea are sent in the resume payload", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();
        await decisionCard.locator(".di__general-notes .di__textarea--notes").fill("These are overarching notes.");

        agui.script = "quick";
        await page.locator('[data-testid="decision-submit"]').click();

        const resume = await expectResumeRan(page, agui);
        expect(resume[0].payload?.generalNotes).toBe("These are overarching notes.");
    });
});

// ─── T-N: Empty general notes are omitted from the payload ───────────────────

test.describe("T-N — empty general notes omitted", () => {
    test("T-N: generalNotes is undefined when the textarea is left empty", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();
        // Do NOT fill general notes — leave empty.

        agui.script = "quick";
        await page.locator('[data-testid="decision-submit"]').click();

        const resume = await expectResumeRan(page, agui);
        expect(resume[0].payload?.generalNotes).toBeUndefined();
    });
});

// ─── T-O: Submit sends answers through the resume payload ────────────────────

test.describe("T-O — resume payload used on submit", () => {
    test("T-O: submit sends the answers through the resume payload (not the legacy submitDecisions RPC)", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();

        agui.script = "quick";
        await page.locator('[data-testid="decision-submit"]').click();

        const resume = await expectResumeRan(page, agui);
        expect(resume[0].interruptId).toBe("decision-interrupt-1");
        expect(resume[0].payload?.answers?.length).toBeGreaterThan(0);
    });
});

// ─── T-P: "Record as decisions" toggle ──────────────────────────────────────

test.describe("T-P — Record as decisions toggle", () => {
    test("T-P1: toggle is visible and checked by default", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });

        const toggle = decisionCard.locator(".di__record-toggle");
        await expect(toggle).toBeVisible();
        await expect(toggle.locator("input")).toBeChecked();
    });

    test("T-P2: unchecking toggle and submitting sends recordAsDecisions=false", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();

        // Uncheck the toggle
        await decisionCard.locator(".di__record-toggle input").uncheck();

        agui.script = "quick";
        await page.locator('[data-testid="decision-submit"]').click();

        const resume = await expectResumeRan(page, agui);
        expect(resume[0].payload?.recordAsDecisions).toBe(false);
    });

    test("T-P3: leaving toggle checked and submitting sends recordAsDecisions=true", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();

        agui.script = "quick";
        await page.locator('[data-testid="decision-submit"]').click();

        const resume = await expectResumeRan(page, agui);
        expect(resume[0].payload?.recordAsDecisions).toBe(true);
    });

    test("T-Q3: toggle is visible regardless of question type", async ({ page, task, agui }) => {
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Trigger the interrupt run (C-4 pattern) — the decision card renders
        // when the /run stream delivers the interrupt outcome.
        await submitChatMessage(page, "interview me");

        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await expect(decisionCard.locator(".di__record-toggle")).toBeVisible();
    });
});

// ─── A6 gap skips — non_exclusive / freetext / Other surfaces ────────────────
//
// DecisionInterrupt.vue verifiably supports non_exclusive (.di__checkbox),
// freetext (.di__textarea--freetext) and Other (.di__textarea--other)
// surfaces, but the mock-agui "interrupt" script serves TWO EXCLUSIVE
// questions only — exercising those surfaces needs a fixture payload knob
// (like 06-01's historyMessages). Per A6 + T-06-20 (06-05 threat register),
// fixture workarounds are out of scope for this plan: the gap is recorded in
// 06-05-SUMMARY.md as a phase-gate decision. Tests stay registered (visible
// in the report) but skipped.

test.describe("T-B — non_exclusive question submit (A6 gap)", () => {
    test("T-B: clicking checkbox enables submit", async ({ page, task, agui }) => {
        test.skip("A6 gap: mock-agui interrupt payload is exclusive-only");
    });

    test("T-B2: clicking checkbox directly also enables submit", async ({ page, task, agui }) => {
        test.skip("A6 gap: mock-agui interrupt payload is exclusive-only");
    });

    test("T-B3: clicking a row in non_exclusive shows description preview but does NOT toggle checkbox", async ({ page, task, agui }) => {
        test.skip("A6 gap: mock-agui interrupt payload is exclusive-only");
    });

    test("T-B4: clicking a row then clicking its checkbox in non_exclusive enables submit", async ({ page, task, agui }) => {
        test.skip("A6 gap: mock-agui interrupt payload is exclusive-only");
    });
});

test.describe("T-C — freetext question submit (A6 gap)", () => {
    test("T-C: typing in freetext textarea enables submit", async ({ page, task, agui }) => {
        test.skip("A6 gap: mock-agui interrupt payload is exclusive-only");
    });

    test("T-C2: clearing freetext after typing disables submit again", async ({ page, task, agui }) => {
        test.skip("A6 gap: mock-agui interrupt payload is exclusive-only");
    });
});

test.describe("T-Q — multiselect Other textarea (A6 gap)", () => {
    test("T-Q1: clicking Other checkbox directly shows Other textarea and enables submit when filled", async ({ page, task, agui }) => {
        test.skip("A6 gap: mock-agui interrupt payload is exclusive-only");
    });

    test("T-Q2: Other checked but text empty keeps submit disabled", async ({ page, task, agui }) => {
        test.skip("A6 gap: mock-agui interrupt payload is exclusive-only");
    });
});

// ─── T-F: Already-answered interview shows read-only state ───────────────────

test.describe("T-F — answered read-only state", () => {
    test("T-F: interview prompt followed by user message renders in read-only mode", async ({ page, api, task }) => {
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] }, { id: 6001 });
        // id must be greater than promptMsg.id so sort order is preserved (prompt first, reply second)
        const userReply = makeUserMessage(task.id, "A: PostgreSQL", { id: promptMsg.id + 1 });
        api.handle("conversations.getMessages", () => messagePage([promptMsg, userReply]));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Should show the answered read-only view, not the interactive form
        await expect(page.locator(".interview")).not.toBeVisible();
        await expect(page.locator(".interview__submit")).not.toBeVisible();
    });
});

// ─── T-G: Interview prompt followed by streaming — answered detection ─────────

test.describe("T-G — answered detection with streaming", () => {
    test("T-G: interview prompt is read-only after assistant starts streaming", async ({ page, api, ws, task }) => {
        const promptMsg = makeInterviewPrompt(task.id, { questions: [exclusiveQuestion] }, { id: 6002 });
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
