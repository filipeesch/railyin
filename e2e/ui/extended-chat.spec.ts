/**
 * extended-chat.spec.ts — Edge-case and advanced chat UI tests.
 *
 * Migrated onto the agui fixture (Phase 6, plan 06-06):
 *   P-12/13/14 (stop/cancel) → C-1 pattern: agui.script = "slow" + stop-btn
 *          click + chat-stopped "Stopped" + deterministic agui.stopRequests
 *          asserts (Pitfall 5 — never timing asserts on the slow script).
 *
 * Retired in-file (P-15, Q-16..20, R-20..25+23, S-1..3 — model selector,
 * compaction, and the legacy decision_request_prompt ws flow): see the
 * retire block at the bottom.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, chatTextarea, submitChatMessage } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { Task } from "@shared/rpc-types";

// ─── Suite P — Execution cancellation ─────────────────────────────────────────

test.describe("P — Execution cancellation", () => {
    test("P-12: stop button hidden when idle, visible when running", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4301, conversationId: 4301, title: "P-12 Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        // Idle: stop button not present.
        const stopBtn = page.locator('[data-testid="stop-btn"]');
        await expect(stopBtn).not.toBeVisible();

        // Slow run: the fixture holds /run open — stop appears while running.
        agui.script = "slow";
        await submitChatMessage(page, "P-12 msg");
        await expect(stopBtn).toBeVisible({ timeout: 5_000 });

        // Stop ends the run — the "Stopped" marker renders and the button
        // disappears (the run is no longer running).
        await stopBtn.click();
        const stopped = page.locator('[data-testid="chat-stopped"]');
        await expect(stopped).toBeVisible({ timeout: 10_000 });
        await expect(stopped).toContainText("Stopped");
        await expect(stopBtn).not.toBeVisible({ timeout: 5_000 });

        // The /stop round-trip hit the fixture for this thread (deterministic
        // assertion, not timing).
        expect(agui.stopRequests).toContain(String(t.conversationId));
    });

    test("P-13: cancel transitions execution to waiting_user", async ({ page, api, ws, agui }) => {
        const t = makeTask({ id: 4302, conversationId: 4302, title: "P-13 Task" });
        const cancelledTask: Task = { ...t, executionState: "waiting_user" };
        api.handle("tasks.list", () => [t]);
        agui.script = "slow";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "P-13 msg");

        // Running: stop visible; click it (C-1 pattern).
        const stopBtn = page.locator('[data-testid="stop-btn"]');
        await expect(stopBtn).toBeVisible({ timeout: 5_000 });
        await stopBtn.click();

        const stopped = page.locator('[data-testid="chat-stopped"]');
        await expect(stopped).toBeVisible({ timeout: 10_000 });
        await expect(stopped).toContainText("Stopped");
        expect(agui.stopRequests).toContain(String(t.conversationId));

        // The task card reflects the cancelled execution (board surface —
        // ws-driven task.updated, untouched by the chat swap).
        ws.push({ type: "task.updated", payload: cancelledTask });
        await expect(page.locator(`[data-task-id="${t.id}"]`)).toHaveClass(/exec-waiting/, { timeout: 5_000 });
    });

    test("P-14: can send a new message after cancel (task recovers)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4303, conversationId: 4303, title: "P-14 Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "slow";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "Recovery P-14");

        // Stop the long run.
        const stopBtn = page.locator('[data-testid="stop-btn"]');
        await expect(stopBtn).toBeVisible({ timeout: 5_000 });
        await stopBtn.click();
        await expect(page.locator('[data-testid="chat-stopped"]')).toBeVisible({ timeout: 10_000 });

        // The task recovers: a follow-up message after the stop completes
        // normally (flip to the quick script so the resumed run finishes).
        agui.script = "quick";
        await submitChatMessage(page, "Recovery P-14 again");

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Recovery P-14 again", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
    });
});

// ─── Retired tests (in-file rationale, plan 06-06) ───────────────────────────
//
// P-15 — compact button in popover disabled while running: the context ring
//        + manual compact popover are removed (compaction is a trimmed
//        feature; compaction_summary is in the FEATURES.md trim list;
//        .ctx-popover only existed in the dead ConversationInput).
// Q-16..Q-20 — model selector shows/updates the task's model: the in-chat
//        model selector is removed with the legacy input (.model-select__value
//        only existed in the dead ConversationInput; per-model config now
//        lives in engines.yaml).
// R-20, R-20b, R-21, R-22, R-23, R-24, R-25 — context ring popover, manual
//        compact, .msg--compaction divider, and context gauge: removed
//        (compaction trimmed; context-ring-btn only existed in the dead
//        ConversationInput).
// S-1..S-3 — decision_request_prompt during streaming and WebSocket
//        disconnect persistence: the legacy ws decision flow is removed; the
//        decision intents are covered by the canonical C-4/C-5 interrupt
//        pattern (decision-card + resume payload via the interrupt script).
