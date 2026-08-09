/**
 * timeline-pipeline.spec.ts — migrated onto the agui fixture (plan 06-04).
 *
 * The streaming intents now run against the canonical fixture scripts
 * (e2e/api/copilotkit/probe-agent.ts + mock-agui.ts):
 *   T-28/30/31/35 + T-37 → S-1 quick script (streaming text)
 *   T-29/32           → C-2 reasoning script ([data-message-id="r1"])
 *
 * The mkEvent helper, StreamEvent-typed builders, ws.pushStreamEvent, and the
 * legacy `.msg__bubble.streaming` / `.rb` selectors are deleted with the
 * legacy pipeline machinery.
 *
 * Retired in-file (rationale per entry at the bottom of this file):
 *   T-33  — referenced in the migration map but absent from the source file
 *   T-34/36 — status_chunk: status/status_chunk is in the FEATURES.md trim
 *           list (removed feature)
 *   T-38, S-1/S-2/S-4, T-46/48/49/53, T-56/57/58, R-1 — legacy stream-pipeline
 *           mechanics (executionId state machines, .rb pulse lifecycle,
 *           virtualized-body ordering/nesting) with no new-stack surface;
 *           their surviving intents are covered by the canonical suites
 *           (S-1/C-1/C-2/T-2) and this file's migrated tests.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { chatTextarea, submitChatMessage } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";

// ─── Suite T — streaming pipeline rendering (migrated) ───────────────────────

test.describe("T — streaming pipeline rendering", () => {
    test("T-28: streamed text renders live in the chat", async ({ page, api, agui }) => {
        const t = makeTask({ id: 301, conversationId: 301, title: "Stream Render Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await submitChatMessage(page, "Hello from T-28");
        await expect(chat).toContainText("Hello from T-28", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
    });

    test("T-29: reasoning renders the collapsed Thinking card (C-2)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 302, conversationId: 302, title: "Reasoning Render Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "reasoning";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "Thinking about T-29");

        // The reasoning card (data-message-id r1) renders collapsed with the
        // streaming/completed label; expand to reveal the summary (canonical
        // C-2 — the legacy .rb/.rb__icon--pulse surface).
        const reasoningCard = page.locator('[data-message-id="r1"]');
        await expect(reasoningCard).toBeVisible({ timeout: 10_000 });
        await expect(reasoningCard).toContainText(/Thinking…|Thought for/);
        await reasoningCard.locator("button").first().click();
        await expect(reasoningCard).toContainText("Comparing two candidate designs");
    });

    test("T-30: the streamed text persists after the run completes", async ({ page, api, agui }) => {
        const t = makeTask({ id: 303, conversationId: 303, title: "Persist Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await submitChatMessage(page, "Live text for T-30");
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // The run completes (RUN_FINISHED) — the assistant text stays rendered
        // as a settled message (legacy "done event clears the streaming bubble"
        // intent: no live marker survives the terminal).
        await expect(chat).toContainText("hello");
        await expect(chatTextarea(page)).toBeEnabled();
    });

    test("T-31: streamed chunks merge into a single assistant message", async ({ page, api, agui }) => {
        const t = makeTask({ id: 304, conversationId: 304, title: "Merge Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await submitChatMessage(page, "word1 word2 word3");

        // The fixture streams the whole sequence into ONE assistant message row
        // (messageId m1) — exactly one merged block, containing all the words.
        await expect(chat.locator('[data-message-id="m1"]')).toHaveCount(1, { timeout: 10_000 });
        await expect(chat.locator('[data-message-id="m1"]')).toContainText("hello");
    });

    test("T-32: the reasoning card renders before the text message in DOM order", async ({ page, api, agui }) => {
        const t = makeTask({ id: 305, conversationId: 305, title: "Order Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "reasoning";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "Reasoning for T-32");

        // Both blocks present; the reasoning card (r1) precedes the text
        // message (m1) in DOM order (legacy .rb-before-.streaming intent).
        const reasoningCard = page.locator('[data-message-id="r1"]');
        const textMessage = page.locator('[data-message-id="m1"]');
        await expect(reasoningCard).toBeVisible({ timeout: 10_000 });
        await expect(textMessage).toBeVisible({ timeout: 10_000 });

        const order = await page
            .locator('[data-message-id]')
            .evaluateAll((els) => els.map((el) => el.getAttribute("data-message-id")));
        const rIdx = order.indexOf("r1");
        const tIdx = order.indexOf("m1");
        expect(rIdx).toBeGreaterThanOrEqual(0);
        expect(tIdx).toBeGreaterThan(rIdx);
    });

    test("T-35: the live indicator clears after the run completes", async ({ page, api, agui }) => {
        const t = makeTask({ id: 306, conversationId: 306, title: "Settle Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "Thinking for T-35");
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // Legacy "reasoning bubble stops pulsing after done" intent: after the
        // terminal, no live-run affordance survives — the stop button is gone
        // and the input is usable again.
        await expect(page.locator('[data-testid="stop-btn"]')).toHaveCount(0, { timeout: 10_000 });
        await expect(chatTextarea(page)).toBeEnabled();
    });

    test("T-37: a second run renders fresh content after the first completes", async ({ page, api, agui }) => {
        const t = makeTask({ id: 307, conversationId: 307, title: "Second Run Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });

        // First execution.
        await submitChatMessage(page, "First execution");
        await expect(chat).toContainText("First execution", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // Second execution with a fresh /run — its user turn renders and the
        // assistant stream arrives again (no ghost state from the prior run).
        await submitChatMessage(page, "Second execution response");
        await expect(chat).toContainText("Second execution response", { timeout: 10_000 });
        await expect.poll(() => agui.runInputs.length).toBe(2);
        await expect(chat).toContainText("hello", { timeout: 10_000 });
    });
});

// ─── Retired tests (in-file rationale, plan 06-04 / T-06-17) ──────────────────
//
// T-33 — referenced in the migration map (T-28/30/31/33/35 → quick) but absent
//        from the source file: no-op.
// T-34, T-36 — status_chunk rendering: status/status_chunk is in the
//        FEATURES.md trim list (removed feature); the reasoning script covers
//        status-ish display via the Thinking card (C-2).
// T-38 — "tool_call clears live reasoning blocks": the legacy StreamBlockNode
//        lifecycle (reasoning cleared by a following tool_call); the new stack
//        renders reasoning and tool calls as independent message types — tool
//        rendering is covered by the canonical T-2 (toolcall script).
// S-1 (T-41) — reasoning-then-text order: duplicated by the migrated T-32.
// S-2 (T-42) — reasoning → tool → text mixed scenario: no combined fixture
//        script exists (reasoning and toolcall are separate scripts); the
//        intents are covered individually by T-32 (order) and T-2 (tools).
// S-4 (T-44) — cancel mid-reasoning ghost blocks: stop behavior is covered by
//        the canonical C-1 (slow script + stopRequests).
// T-46, T-53 — incremental chunk growth: legacy block-merge mechanics; the
//        progressive-streaming intent is covered by F-1 / A-1 (stream-reactivity).
// T-48 — reasoning open-while-streaming / collapse-after-done: legacy .rb
//        pulse lifecycle; C-2 covers the settled card.
// T-49 — nested tool_call children (.tcg nesting): the canonical fixture has
//        no parent/child toolCallId relationship (flat tool set).
// T-56, T-57, T-58 — sequential/interleaved ordering in the virtualized body:
//        legacy pipeline mechanics; tool-card presence and order are covered
//        by S-24 (tool-rendering) and the canonical T-2.
// R-1 — execution isolation (new executionId clears old blocks): the
//        executionId state machine is legacy; consecutive-run freshness is
//        covered by the migrated T-37 and by conversation-stream-state's
//        per-thread isolation suite.
