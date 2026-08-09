/**
 * conversation-body.spec.ts — UI tests for the chat body surface.
 *
 * Suite CB — conversation body coverage:
 *   CB-1: reasoning card renders alongside the streamed answer (C-2)
 *   CB-1b: persisted (replayed) reasoning starts collapsed, expandable
 *   CB-3: tool groups render in the shared body (T-2)
 *
 * Migrated onto the agui fixture (Phase 6, plan 06-03): CB-1/CB-1b use the
 * C-2 reasoning pattern (agui.script = "reasoning", [data-message-id="r1"]
 * card, collapsed → expand → summary); CB-3 uses the T-2 toolcall pattern
 * (tool-card-* group rendering).
 *
 * Retired in-file (trimmed/deferred features — recorded in plan 06-03):
 *   CB-2 — virtualization: PERF-01 deferred; full-history replay is the v1
 *     behavior (the CopilotChat scroll view renders the complete thread).
 *   CB-4 — transition cards: transition_event is in the trim list; the
 *     legacy prompt rows and the transition card rendering are gone with
 *     ConversationBody (that whole card-era surface is retired with the
 *     feature).
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, chatTextarea, submitChatMessage } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";

test.describe("CB — conversation body coverage", () => {
    test("CB-1: reasoning card renders alongside the streamed answer (C-2)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 301, conversationId: 301, title: "Reasoning Body Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "reasoning";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "walk me through it");

        // The reasoning card (data-message-id r1) renders with the
        // streaming/completed label…
        const reasoningCard = page.locator('[data-message-id="r1"]');
        await expect(reasoningCard).toBeVisible({ timeout: 10_000 });
        await expect(reasoningCard).toContainText(/Thinking…|Thought for/);

        // …expand it to reveal the summary; the streamed answer text follows
        // in the shared body.
        await reasoningCard.locator("button").first().click();
        await expect(reasoningCard).toContainText("Comparing two candidate designs");
        await expect(page.locator('[data-testid="copilot-chat-view"]')).toContainText("here is the answer");
    });

    test("CB-1b: persisted reasoning starts collapsed, expandable (C-2)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 302, conversationId: 302, title: "Persisted Reasoning Task" });
        api.handle("tasks.list", () => [t]);
        // Fixture-driven replay: the connect MESSAGES_SNAPSHOT carries a
        // reasoning-role message — replayed (non-streaming) reasoning starts
        // collapsed with the "Thought for" label (the legacy DB-loaded
        // reasoning-bubble intent).
        agui.registerHistory(String(t.conversationId), [
            { id: "r1", role: "reasoning", content: "Some persisted reasoning content" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const reasoningCard = page.locator('[data-message-id="r1"]');
        await expect(reasoningCard).toBeVisible({ timeout: 10_000 });
        await expect(reasoningCard).toContainText(/Thought for/);

        // Replayed reasoning starts collapsed (aria-expanded false) — the
        // content stays hidden until the header is clicked.
        const toggle = reasoningCard.locator("button").first();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");

        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(reasoningCard).toContainText("Some persisted reasoning content");
    });

    test("CB-3: tool groups render in the shared body (T-2)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 303, conversationId: 303, title: "Tool Body Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "run the tools");

        // Each tool-call family renders its card in the shared message body —
        // shell, delegate, and write_file all visible (T-2 pattern).
        const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
        await expect(bashCard).toBeVisible({ timeout: 10_000 });
        await expect(bashCard).toContainText("ls -la");
        await bashCard.locator("button").first().click();
        await expect(bashCard).toContainText("total 8");

        const subCard = page.locator('[data-testid="tool-card-tc-sub"]');
        await expect(subCard).toBeVisible();
        await expect(subCard).toContainText("Write the auth module");

        const writeCard = page.locator('[data-testid="tool-card-tc-write"]');
        await expect(writeCard).toBeVisible();
        await expect(writeCard).toContainText("src/auth.ts");
    });
});
