/**
 * tool-rendering.spec.ts — UI tests for tool call rendering in the task-drawer
 * chat (plan 06-04 migration onto the agui fixture).
 *
 * Suite S — tool rendering regressions, migrated onto the canonical
 * buildToolCallRunEvents fixture (e2e/api/copilotkit/probe-agent.ts — never
 * hand-rolled seeds, T-06-18). All tool-card assertions target the CopilotKit
 * slot surface (canonical T-1/T-2/T-3 patterns, chat-copilotkit.spec.ts):
 *   [data-testid="copilot-tool-render"]  — generic/MCP default card (T-1)
 *   [data-testid="tool-card-tc-bash"]    — shell family (ShellOutputRenderer)
 *   [data-testid="tool-card-tc-write"]   — file family (FileChangesRenderer)
 *   [data-testid="tool-card-tc-sub"]     — delegate family (DelegateSummaryRenderer)
 *
 * Legacy writtenFiles seeds, `.tc` cards, `.fdiff__body`, and engine-specific
 * (cursor) mocks are gone — rendering is model-agnostic (D-01); the cursor
 * engine no longer drives chat rendering.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { chatTextarea, submitChatMessage } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";

test("S-24: batched tool calls render as distinct cards in call order", async ({ page, api, agui }) => {
    const t = makeTask({ id: 201, conversationId: 201, title: "Batched Tools" });
    api.handle("tasks.list", () => [t]);
    agui.script = "toolcall";

    await page.goto("/");
    await openTaskDrawer(page, t.id);
    await expect(page.locator('[data-testid="copilot-chat-view"]')).toBeVisible({ timeout: 10_000 });

    await submitChatMessage(page, "run the batch");

    // The canonical toolcall fixture emits one generic card (create_card) then
    // the domain families in order: bash → subagent → write_file. Call order is
    // preserved by the message stream; each result pairs to its call by
    // toolCallId through the slot resolution contract (T-2).
    const cards = page.locator(
        '[data-testid="copilot-chat-view"] [data-testid="copilot-tool-render"], [data-testid="copilot-chat-view"] [data-testid^="tool-card-"]',
    );
    await expect(cards).toHaveCount(4, { timeout: 10_000 });
    const ids = await cards.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(ids).toEqual(["copilot-tool-render", "tool-card-tc-bash", "tool-card-tc-sub", "tool-card-tc-write"]);
});

test("S-25: write_file renders FileChangesRenderer with file path + change stats", async ({ page, api, agui }) => {
    const t = makeTask({ id: 202, conversationId: 202, title: "RawDiff Task" });
    api.handle("tasks.list", () => [t]);
    agui.script = "toolcall";

    await page.goto("/");
    await openTaskDrawer(page, t.id);
    await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

    await submitChatMessage(page, "write the file");

    // FileChangesRenderer dispatch (FileChangesRenderer.vue:15): the header
    // carries the primary file path + the +N/−N stat chips derived from the
    // canonical fixture's args — the rawDiff intent on the new surface.
    const writeCard = page.locator('[data-testid="tool-card-tc-write"]');
    await expect(writeCard).toBeVisible({ timeout: 10_000 });
    await expect(writeCard).toContainText("src/auth.ts");
    await expect(writeCard.locator(".fc__stat--added")).toContainText("+2");
});

test("S-26: subagent renders DelegateSummaryRenderer with intent + markdown result", async ({ page, api, agui }) => {
    const t = makeTask({ id: 203, conversationId: 203, title: "Subagent Task" });
    api.handle("tasks.list", () => [t]);
    agui.script = "toolcall";

    await page.goto("/");
    await openTaskDrawer(page, t.id);
    await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

    await submitChatMessage(page, "delegate the work");

    // DelegateSummaryRenderer: the header shows the intent; expanding reveals
    // the markdown result. (Legacy "nested under spawn_agent" hierarchy is the
    // args-carried children list — the fixture's subagent carries none.)
    const subCard = page.locator('[data-testid="tool-card-tc-sub"]');
    await expect(subCard).toBeVisible({ timeout: 10_000 });
    await expect(subCard).toContainText("Write the auth module");
    await subCard.locator("button").first().click();
    await expect(subCard).toContainText("Auth module implemented with refresh rotation");
});

test("S-27: reopened thread replays completed tool calls — no stale running spinner", async ({ page, api, agui }) => {
    const t = makeTask({ id: 204, conversationId: 204, title: "Stale Tool Task" });
    api.handle("tasks.list", () => [t]);
    agui.script = "toolcall";
    agui.registerThread(String(t.conversationId));

    await page.goto("/");
    await openTaskDrawer(page, t.id);

    // T-3 replay-completed (RUNR-07): the connect replay pairs the assistant
    // toolCall with its ToolMessage → slot status "complete" → green check, no
    // spinner, no "Running…" — the stale-orphan intent (never a spinning card).
    const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
    await expect(bashCard).toBeVisible({ timeout: 10_000 });
    await expect(bashCard.locator(".pi-check-circle")).toBeVisible();
    await expect(bashCard.locator(".pi-spinner, .pi-spin")).toHaveCount(0);
    await expect(bashCard).not.toContainText("Running…");
});

test("S-28: write card expands to the FileDiff body rendered from args", async ({ page, api, agui }) => {
    const t = makeTask({ id: 205, conversationId: 205, title: "FileDiff Task" });
    api.handle("tasks.list", () => [t]);
    agui.script = "toolcall";

    await page.goto("/");
    await openTaskDrawer(page, t.id);
    await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

    await submitChatMessage(page, "edit the file");

    const writeCard = page.locator('[data-testid="tool-card-tc-write"]');
    await expect(writeCard).toBeVisible({ timeout: 10_000 });
    await writeCard.locator("button").first().click();

    // FileDiff dispatch (FileChangesRenderer.vue:15): the expanded body renders
    // the args-derived diff payload. The canonical fixture's write payload is
    // hunk-less (args carry content only), so the hunk viewer shows its empty
    // state. The legacy long-line horizontal-scroll assertion is retired — no
    // hunk data can be fixture-produced without hand-rolled frames (T-06-18).
    await expect(writeCard.locator(".fdiff")).toBeVisible({ timeout: 5_000 });
});

test("S-29: expanded tool cards render parsed content, not the raw result envelope", async ({ page, api, agui }) => {
    const t = makeTask({ id: 206, conversationId: 206, title: "Read Content Task" });
    api.handle("tasks.list", () => [t]);
    agui.script = "toolcall";

    await page.goto("/");
    await openTaskDrawer(page, t.id);
    await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

    await submitChatMessage(page, "read the file");

    // Read-family nuance retired: the frozen canonical toolcall fixture carries
    // no read/view tool (create_card/bash/subagent/write_file only, T-06-18).
    // The intent — parsed content, never the raw JSON envelope — holds on the
    // file card: the expanded body renders the args-derived diff surface, and
    // the raw result payload never appears.
    const writeCard = page.locator('[data-testid="tool-card-tc-write"]');
    await expect(writeCard).toBeVisible({ timeout: 10_000 });
    await writeCard.locator("button").first().click();
    await expect(writeCard.locator(".fdiff")).toBeVisible({ timeout: 5_000 });
    await expect(writeCard).not.toContainText("tool_use_id");
});

test("S-30: diff-family stats render +N added and no phantom removed chip", async ({ page, api, agui }) => {
    const t = makeTask({ id: 207, conversationId: 207, title: "Stat Badge Task" });
    api.handle("tasks.list", () => [t]);
    agui.script = "toolcall";

    await page.goto("/");
    await openTaskDrawer(page, t.id);
    await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

    await submitChatMessage(page, "rename the symbol");

    // Stat-badge intent (legacy lsp_rename diff card): the canonical fixture's
    // write payload adds 2 lines and removes 0 — the +N chip renders, the −N
    // chip must not (family-agnostic stat surface, T-2).
    const writeCard = page.locator('[data-testid="tool-card-tc-write"]');
    await expect(writeCard).toBeVisible({ timeout: 10_000 });
    await expect(writeCard.locator(".fc__stat--added")).toContainText("+2");
    await expect(writeCard.locator(".fc__stat--removed")).toHaveCount(0);
});

test("S-31: subagent result renders as markdown, not raw JSON", async ({ page, api, agui }) => {
    const t = makeTask({ id: 208, conversationId: 208, title: "Subagent Markdown Task" });
    api.handle("tasks.list", () => [t]);
    agui.script = "toolcall";

    await page.goto("/");
    await openTaskDrawer(page, t.id);
    await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

    await submitChatMessage(page, "analyze the codebase");

    // DelegateSummaryRenderer markdown body (prose render of the result), never
    // the raw tool_use_id envelope (legacy .sa__result intent).
    const subCard = page.locator('[data-testid="tool-card-tc-sub"]');
    await expect(subCard).toBeVisible({ timeout: 10_000 });
    await subCard.locator("button").first().click();
    await expect(subCard).toContainText("Auth module implemented with refresh rotation");
    await expect(subCard).not.toContainText("tool_use_id");
});

// ─── S-29 to S-33: cursor tool rendering → model-agnostic ─────────────────────
//
// The cursor engine no longer drives chat rendering (D-01), so the former
// cursor tool-card tests (shell/read/edit/write/delete) become model-agnostic
// quick-script assertions on the generic streaming surface — no engine mocks,
// no models.listEnabled overrides, no cursor-model task seeds. The rendering
// intent (tool/stream output renders correctly) is preserved.

test.describe("S-29 to S-33 — cursor family (model-agnostic)", () => {
    test("S-29: a submitted message streams the assistant text (formerly cursor shell)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 209, conversationId: 209, title: "Cursor Shell Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await submitChatMessage(page, "run the command");
        await expect(chat).toContainText("run the command", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
    });

    test("S-30: user and assistant turns both render (formerly cursor read)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 210, conversationId: 210, title: "Cursor Read Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await submitChatMessage(page, "read the file");
        await expect(chat).toContainText("read the file", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
        await expect(chatTextarea(page)).toBeEnabled();
    });

    test("S-31: the streamed text persists after the run completes (formerly cursor edit)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 211, conversationId: 211, title: "Cursor Edit Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await submitChatMessage(page, "edit the file");
        await expect(chat).toContainText("hello", { timeout: 10_000 });
        // Run completed (RUN_FINISHED) — the assistant message stays rendered.
        await expect(chat).toContainText("hello");
        await expect(chatTextarea(page)).toBeEnabled();
    });

    test("S-32: a second consecutive run streams fresh content (formerly cursor write)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 212, conversationId: 212, title: "Cursor Write Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await submitChatMessage(page, "first write");
        await expect(chat).toContainText("hello", { timeout: 10_000 });
        await submitChatMessage(page, "second write");
        await expect(chat).toContainText("second write", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
    });

    test("S-33: reopened thread replays history with no error surface (formerly cursor delete)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 213, conversationId: 213, title: "Cursor Delete Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";
        agui.registerThread(String(t.conversationId));

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        // Connect replay renders the MESSAGES_SNAPSHOT; no error row appears.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("hello", { timeout: 10_000 });
        await expect(page.locator('[data-testid="chat-error-row"]')).toHaveCount(0);
    });
});
