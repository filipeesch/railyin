/**
 * cursor.spec.ts — UI tests for tasks running under the Cursor SDK engine.
 *
 * The chat surface is engine-agnostic (D-01): streaming, tool rendering, and
 * decision requests come through engine-neutral AG-UI events, so these tests
 * prove the render paths work under model-agnostic agui scripts — no cursor
 * model id is needed anywhere on the wire.
 *
 * Migrated onto the agui fixture (Phase 6, plan 06-06):
 *   CU-2.1  token streaming → S-1 (quick script + /run stream)
 *   CU-3.1  tool_call + tool_result render → toolcall script (T-2 surface)
 *   CU-4.1  decision_request → C-4 interrupt pattern (decision-card)
 *   CU-3.1 (shell) → toolcall script tool-card-tc-bash (collapsible output)
 *   CU-3.2 (read)  → toolcall script tool-card-tc-write (FileChangesRenderer)
 *
 * Retired in-file (CU-1.1/1.2 — model picker removed with the legacy input;
 * .input-model-select only existed in the dead ConversationInput.vue:175):
 * see the retire block at the bottom.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, chatTextarea, submitChatMessage } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";

// ─── CU-2: Token streaming ───────────────────────────────────────────────────

test.describe("CU-2 — token streaming", () => {
    test("CU-2.1: text_chunk events render in the chat surface", async ({ page, api }) => {
        const t = makeTask({ id: 4101, conversationId: 4101, title: "Cursor Streaming Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "Hello cursor");

        // The assistant text streams via /run (S-1 pattern) — the streaming
        // render path is engine-agnostic (model-agnostic per the migration map).
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Hello cursor", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
    });
});

// ─── CU-3: Tool rendering ─────────────────────────────────────────────────────

test.describe("CU-3 — tool rendering", () => {
    test("CU-3.1: tool_call + tool_result messages render in the chat surface", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4102, conversationId: 4102, title: "Cursor Tool Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "run it");

        // The shell tool card renders name + args (T-2 surface — the legacy
        // .tc group analog, model-agnostic).
        const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
        await expect(bashCard).toBeVisible({ timeout: 10_000 });
        await expect(bashCard).toContainText("ls -la");

        // The trailing assistant text also renders.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Handling that now.", { timeout: 10_000 });
    });
});

// ─── CU-4: Decision request ──────────────────────────────────────────────────

test.describe("CU-4 — decision request", () => {
    test("CU-4.1: decision_request renders the decision card", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4103, conversationId: 4103, title: "Cursor Decision Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "decide this");

        // The #interrupt slot renders DecisionInterrupt with the payload's
        // two questions (C-4 pattern — replaces the legacy .interview UI).
        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await expect(decisionCard).toContainText("Should I apply the changes to src/auth.ts?");

        // Submit stays disabled until all questions are answered.
        const submit = page.locator('[data-testid="decision-submit"]');
        await expect(submit).toBeDisabled();
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();
        await expect(submit).toBeEnabled();

        // Resume completes through the quick script; the resume POST /run
        // carries non-empty answers.
        agui.script = "quick";
        await submit.click();
        await expect
            .poll(() => (agui.lastRunInput as { resume?: unknown[] } | null)?.resume?.length ?? 0, { timeout: 10_000 })
            .toBeGreaterThan(0);
        const resume = (agui.lastRunInput as { resume: Array<{ interruptId: string; payload: { answers?: unknown[] } }> }).resume;
        expect(resume[0].interruptId).toBe("decision-interrupt-1");
        expect(resume[0].payload.answers?.length).toBeGreaterThan(0);
    });
});

// ─── CU-3.1: Shell tool display ──────────────────────────────────────────────

test.describe("CU-3.1 — shell tool display", () => {
    test("CU-3.1: shell tool shows command in collapsible header", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4104, conversationId: 4104, title: "Cursor Shell Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "run it");

        // The shell tool card shows the command (canonical label "bash") in
        // the header; the output appears after expanding the card.
        const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
        await expect(bashCard).toBeVisible({ timeout: 10_000 });
        await expect(bashCard).toContainText("ls -la");
        await bashCard.locator("button").first().click();
        await expect(bashCard).toContainText("total 8");
    });
});

// ─── CU-3.2: Read tool display ───────────────────────────────────────────────

test.describe("CU-3.2 — read tool display", () => {
    test("CU-3.2: read tool shows file path in collapsible", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4105, conversationId: 4105, title: "Cursor Read Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "run it");

        // The file-family card (FileChangesRenderer — the read family's
        // renderer, RailyinChat.vue) shows the path.
        const writeCard = page.locator('[data-testid="tool-card-tc-write"]');
        await expect(writeCard).toBeVisible({ timeout: 10_000 });
        await expect(writeCard).toContainText("src/auth.ts");
    });
});

// ─── Retired tests (in-file rationale, plan 06-06) ───────────────────────────
//
// CU-1.1 — model picker exposes cursor/* models: the in-chat model picker is
//        removed with the legacy input (.input-model-select only existed in
//        the dead ConversationInput.vue:175); model assignment is now
//        engines.yaml / task-model configuration, outside the chat surface.
// CU-1.2 — selecting a cursor model updates the task's model: same surface
//        removal as CU-1.1; the tasks.setModel RPC has no chat UI consumer.
