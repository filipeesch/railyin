/**
 * delegate-rendering.spec.ts — UI tests for delegate tool call rendering.
 *
 * Suite S-D — delegate tool rendering:
 *   S-D1: delegate tool call renders the DelegateSummaryRenderer card
 *   S-D2: card header shows the delegate intent label
 *   S-D3: expanding the card reveals the markdown result
 *   S-D4: exactly one delegate card renders (no duplicated nesting)
 *   S-D5: every emitted tool call renders its own standalone card
 *
 * Migrated onto the agui fixture (Phase 6, plan 06-03): the delegate
 * (subagent family) tool call renders through the DelegateSummaryRenderer
 * via [data-testid="tool-card-tc-sub"] — the T-2 pattern (agui.script =
 * "toolcall"): the card header shows the intent ("Write the auth module"),
 * expanding via the header button reveals the result markdown.
 *
 * The legacy makeDelegateMessages seed, the .delegate-divider /
 * .msg--assistant / .tc selectors, and test.describe.configure({ mode:
 * "serial" }) are all deleted: per-test agui fixtures make parallel workers
 * safe (Pitfall 4 — the page.route clobbering that forced serial mode is
 * gone, since all chat traffic now routes through the auto-installed
 * /api/copilotkit/** handler).
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, chatTextarea, submitChatMessage } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";

test.describe("S-D — delegate tool rendering", () => {
    test("S-D1: delegate tool call renders the DelegateSummaryRenderer card", async ({ page, api, agui }) => {
        const t = makeTask({ id: 201, conversationId: 201, title: "Delegate Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "delegate this");

        // The subagent tool call renders the delegate card (T-2 pattern) —
        // the legacy divider-with-count intent.
        await expect(page.locator('[data-testid="tool-card-tc-sub"]')).toBeVisible({ timeout: 10_000 });
    });

    test("S-D2: delegate card header shows the intent label", async ({ page, api, agui }) => {
        const t = makeTask({ id: 202, conversationId: 202, title: "Delegate Label Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "run the delegate");

        // The card header carries the delegate intent verbatim (the legacy
        // plural-label intent — the header labels the delegation).
        const subCard = page.locator('[data-testid="tool-card-tc-sub"]');
        await expect(subCard).toBeVisible({ timeout: 10_000 });
        await expect(subCard).toContainText("Write the auth module");
    });

    test("S-D3: expanding the delegate card reveals the markdown result", async ({ page, api, agui }) => {
        const t = makeTask({ id: 203, conversationId: 203, title: "Delegate Result Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "summarize the delegate");

        // Expanding the card reveals the delegate's result markdown (the
        // legacy digest-message intent).
        const subCard = page.locator('[data-testid="tool-card-tc-sub"]');
        await expect(subCard).toBeVisible({ timeout: 10_000 });
        await expect(subCard).toContainText("Write the auth module");
        await subCard.locator("button").first().click();
        await expect(subCard).toContainText("Auth module implemented with refresh rotation");
    });

    test("S-D4: exactly one delegate card renders — no duplicated nesting", async ({ page, api, agui }) => {
        const t = makeTask({ id: 204, conversationId: 204, title: "Delegate Single Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "delegate once");

        // The single delegation emits exactly one card — no nested or
        // duplicated delegate rendering (the legacy no-nested-cards intent).
        const subCards = page.locator('[data-testid="tool-card-tc-sub"]');
        await expect(subCards).toHaveCount(1, { timeout: 10_000 });
    });

    test("S-D5: every emitted tool call renders its own standalone card", async ({ page, api, agui }) => {
        const t = makeTask({ id: 205, conversationId: 205, title: "Delegate All Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "run all the tools");

        // The toolcall script emits bash / subagent / write_file — each tool
        // call renders its own card keyed by toolCallId (the legacy
        // orphaned-children intent: nothing gets grouped away; the new
        // surface is flat per-toolCallId).
        await expect(page.locator('[data-testid="tool-card-tc-bash"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-testid="tool-card-tc-sub"]')).toBeVisible();
        await expect(page.locator('[data-testid="tool-card-tc-write"]')).toBeVisible();
    });
});
