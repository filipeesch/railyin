/**
 * chat-copilotkit.spec.ts — the Phase 5 chat suite: the task-drawer Chat tab
 * now renders the CopilotKit surface (RailyinChat.vue) instead of the legacy
 * ConversationBody/ConversationInput stack. All AG-UI traffic flows through
 * the `agui` fixture (MockAgui) against /api/copilotkit/*; every other RPC is
 * mocked by the api fixture baseline.
 *
 * Suites:
 *   S — streaming (CHAT-01), history-on-reopen (CHAT-07), empty state
 *       (RUNR-06), error state (RUN_ERROR)
 *   T — tool cards (CHAT-03): default card (D-04), domain renderers, replay
 *       completed state (RUNR-07)
 *   C — stop + "Stopped" label (CHAT-04), reasoning (CHAT-05), slash commands
 *       (CHAT-06), decision interrupt (D-06)
 *
 * Wire contract (verified in mock-agui.ts): POST /agent/:agentId/run streams
 * the scripted event sequences (quick/toolcall/reasoning/interrupt/slow);
 * POST /agent/:agentId/connect replays history for registered threads
 * (MESSAGES_SNAPSHOT) and an empty SSE body for never-run threads; the
 * threadId arrives in the request BODY for run/connect (parseConnectRequest)
 * and in the URL PATH for /stop.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, openSidebar } from "./fixtures";
import { makeTask, makeChatSession } from "./fixtures/mock-data";
import type { Page } from "@playwright/test";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The CopilotChatInput textarea inside our #input slot wrapper. */
function chatTextarea(page: Page) {
    return page.locator('[data-testid="chat-input"] textarea');
}

/** Track POSTs to /agent/default/connect (the CHAT-07 replay requests).
 *  The threadId arrives in the request BODY (parseConnectRequest mirrors the
 *  real runtime) — extract and record it. */
function collectConnectRequests(page: Page): string[] {
    const requests: string[] = [];
    page.on("request", (req) => {
        if (req.method() === "POST" && /\/agent\/default\/connect$/.test(new URL(req.url()).pathname)) {
            try {
                const body = JSON.parse(req.postData() ?? "{}") as { threadId?: unknown };
                if (typeof body.threadId === "string") requests.push(body.threadId);
            } catch {
                // Malformed body — ignore; the fixture route mirrors the 400.
            }
        }
    });
    return requests;
}

async function submitChatMessage(page: Page, text: string): Promise<void> {
    const input = chatTextarea(page);
    await input.click();
    await input.pressSequentially(text);
    await page.keyboard.press("Enter");
}

// ─── Suite S — streaming & history (CHAT-01, CHAT-07) ─────────────────────────

test.describe("S — CopilotKit streaming & history", () => {    test("S-1: submitted message streams the assistant text via /run (CHAT-01)", async ({ page, api }) => {
        // Never-run thread (NOT registered with MockAgui): connect answers an
        // empty SSE body, so the ONLY source of the assistant "hello" text is
        // the /run stream — the streaming proof is unambiguous.
        const t = makeTask({ id: 101, conversationId: 101, title: "Streaming Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await expect(chatTextarea(page)).toBeEnabled();

        await submitChatMessage(page, "stream this please");

        // The user message renders (RUN_STARTED carries the run input) and the
        // assistant response streams token-by-token from buildQuickRunEvents.
        await expect(chat).toContainText("stream this please", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
    });

    test("S-2: reopening the drawer replays full history via /connect (CHAT-07)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 102, conversationId: 102, title: "History Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerThread(String(t.conversationId));

        const connectRequests = collectConnectRequests(page);
        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        // Connect replay renders the MESSAGES_SNAPSHOT assistant message.
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // Close the drawer (unmounts TaskChatView → new mount on reopen) and
        // reopen — the prior assistant text must render again via the replay.
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        await openTaskDrawer(page, t.id);
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // The second open triggered a fresh POST /agent/default/connect for
        // the task's threadId (the CHAT-07 replay chain).
        expect(connectRequests.length).toBeGreaterThanOrEqual(2);
        expect(connectRequests).toContain(String(t.conversationId));
    });
});

// ─── Suite E — empty & error states (RUNR-06, RUN_ERROR) ──────────────────────

test.describe("E — chat states", () => {
    test("E-1: never-run thread renders the empty state with the input enabled (RUNR-06)", async ({ page, api }) => {
        const t = makeTask({ id: 103, conversationId: 103, title: "Empty Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        // Connect resolves with an empty SSE body (thread NOT registered) →
        // the UI-SPEC empty copy renders and the input stays usable.
        const emptyState = page.locator('[data-testid="chat-empty-state"]');
        await expect(emptyState).toBeVisible({ timeout: 10_000 });
        await expect(emptyState).toContainText("No messages yet");
        await expect(emptyState).toContainText("Send a message to start, or type / to browse commands.");
        await expect(chatTextarea(page)).toBeEnabled();
    });

    test("E-2: RUN_ERROR renders an inline error row + toast; input re-enables", async ({ page, api, agui }) => {
        const t = makeTask({ id: 104, conversationId: 104, title: "Error Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "error"; // /run serves the RUN_ERROR-terminated SSE body

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "trigger the failure");

        // Inline error row (RUN_ERROR terminal, message "simulated failure").
        const errorRow = page.locator('[data-testid="chat-error-row"]');
        await expect(errorRow).toBeVisible({ timeout: 10_000 });
        await expect(errorRow).toContainText("Execution failed: simulated failure");

        // PrimeVue error toast (legacy onStreamError parity).
        await expect(page.locator(".p-toast")).toContainText("Execution failed", { timeout: 5_000 });

        // The input re-enables after the failed run.
        await expect(chatTextarea(page)).toBeEnabled();
    });
});

// ─── Suite T — tool cards (CHAT-03, D-04) ─────────────────────────────────────

test.describe("T — tool cards", () => {
    test("T-1: generic tools render the default card (D-04, A4)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 201, conversationId: 201, title: "Toolcard Default Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "make a card");

        // The generic create_card tool falls through to useDefaultRenderTool
        // (data-testid copilot-tool-render) — name + status in the header;
        // args/result appear after expanding the card.
        const defaultCard = page.locator('[data-testid="copilot-tool-render"]');
        await expect(defaultCard).toBeVisible({ timeout: 10_000 });
        await expect(defaultCard).toContainText("create_card");
        await expect(defaultCard).toContainText("Done");
        await defaultCard.locator("button").first().click();
        await expect(defaultCard).toContainText("A new card");
        await expect(defaultCard).toContainText('"ok":true');
    });

    test("T-2: domain families render the ported renderers (shell/delegate/file), not raw JSON", async ({ page, api, agui }) => {
        const t = makeTask({ id: 202, conversationId: 202, title: "Toolcard Domain Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "run it");

        // Shell family → ShellOutputRenderer: header shows the command, body
        // shows the truncated output after expanding.
        const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
        await expect(bashCard).toBeVisible({ timeout: 10_000 });
        await expect(bashCard).toContainText("ls -la");
        await bashCard.locator("button").first().click();
        await expect(bashCard).toContainText("total 8");

        // Delegate family → DelegateSummaryRenderer: intent + result markdown.
        const subCard = page.locator('[data-testid="tool-card-tc-sub"]');
        await expect(subCard).toBeVisible();
        await expect(subCard).toContainText("Write the auth module");
        await subCard.locator("button").first().click();
        await expect(subCard).toContainText("Auth module implemented with refresh rotation");

        // Write family → FileChangesRenderer: +N/−N stat chips derived from args.
        const writeCard = page.locator('[data-testid="tool-card-tc-write"]');
        await expect(writeCard).toBeVisible();
        await expect(writeCard).toContainText("src/auth.ts");
        await expect(writeCard).toContainText("+2");
    });

    test("T-3: reopened thread replays completed tool calls — no stale running spinner (RUNR-07, D-05)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 203, conversationId: 203, title: "Toolcard Replay Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";
        agui.registerThread(String(t.conversationId));

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        // Connect replay (script toolcall) pairs the assistant toolCall with
        // its ToolMessage → slot status "complete" → green check, no spinner.
        const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
        await expect(bashCard).toBeVisible({ timeout: 10_000 });
        await expect(bashCard.locator(".pi-check-circle")).toBeVisible();
        await expect(bashCard.locator(".pi-spinner, .pi-spin")).toHaveCount(0);
        await expect(bashCard).not.toContainText("Running…");
    });
});

// ─── Suite C — stop, reasoning, slash, decision (CHAT-04/05/06, D-06) ────────

test.describe("C — stop, reasoning, slash, decision", () => {
    test("C-1: stop mid-run labels the partial response 'Stopped' and POSTs /stop (CHAT-04, D-08)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 301, conversationId: 301, title: "Stop Task" });
        api.handle("tasks.list", () => [t]);
        // Slow variant: the fixture holds the /run response open (terminal-less
        // body) so the run stays isRunning until the stop click lands.
        agui.script = "slow";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "start something long");

        // Stop button shows while isRunning.
        const stopBtn = page.locator('[data-testid="stop-btn"]');
        await expect(stopBtn).toBeVisible({ timeout: 5_000 });

        // Stop → abortRun → POST /agent/default/stop/:threadId (fixture captures).
        await stopBtn.click();

        // The run finalizes client-side (aborted fetch) and the "Stopped"
        // marker renders — pure client state, never derived from wire events.
        const stopped = page.locator('[data-testid="chat-stopped"]');
        await expect(stopped).toBeVisible({ timeout: 10_000 });
        await expect(stopped).toContainText("Stopped");

        // The /stop round-trip hit the fixture for this thread.
        expect(agui.stopRequests).toContain(String(t.conversationId));
    });

    test("C-2: reasoning renders the collapsed Thinking card, expandable with summary (CHAT-05)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 302, conversationId: 302, title: "Reasoning Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "reasoning";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "why?");

        // The reasoning card (data-message-id r1) renders collapsed with the
        // streaming/completed label; expand to reveal the summary.
        const reasoningCard = page.locator('[data-message-id="r1"]');
        await expect(reasoningCard).toBeVisible({ timeout: 10_000 });
        await expect(reasoningCard).toContainText(/Thinking…|Thought for/);

        await reasoningCard.locator("button").first().click();
        await expect(reasoningCard).toContainText("Comparing two candidate designs");
    });

    test("C-3: slash commands list '/name' from the registry and insert the command (CHAT-06, D-07)", async ({ page, api }) => {
        const t = makeTask({ id: 303, conversationId: 303, title: "Slash Task" });
        api.handle("tasks.list", () => [t]);
        api.handle("engine.listCommands", () => [{ name: "fake-cmd", description: "d" }]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        // Typing "/" opens the slash menu with the registry command.
        const input = chatTextarea(page);
        await input.click();
        await input.pressSequentially("/");

        const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
        await expect(slashMenu).toBeVisible({ timeout: 5_000 });
        const option = slashMenu.locator('[role="option"]', { hasText: "/fake-cmd" });
        await expect(option).toBeVisible();

        // Clicking inserts the full slash text as the leading input value.
        await option.click();
        await expect(input).toHaveValue("/fake-cmd");
    });

    test("C-4: decision interrupt renders the ported card; submit resumes with non-empty answers (D-06)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 304, conversationId: 304, title: "Decision Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "interrupt";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "decide this");

        // The #interrupt slot renders DecisionInterrupt with the payload's
        // two questions (exclusive with options).
        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await expect(decisionCard).toContainText("Should I apply the changes to src/auth.ts?");

        // Fill the required answers (one option row per question).
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();

        const submit = page.locator('[data-testid="decision-submit"]');
        await expect(submit).toBeEnabled();
        // Resume completes through the quick script (the fixture no longer
        // serves the interrupt terminal).
        agui.script = "quick";
        await submit.click();

        // The resume POST /run carries non-empty answers (INVALID_PAYLOAD
        // contract — event-bridge.ts:402-422).
        await expect
            .poll(() => (agui.lastRunInput as { resume?: unknown[] } | null)?.resume?.length ?? 0, { timeout: 10_000 })
            .toBeGreaterThan(0);
        const resume = (agui.lastRunInput as { resume: Array<{ interruptId: string; status: string; payload: { answers?: unknown[] } }> }).resume;
        expect(resume[0].interruptId).toBe("decision-interrupt-1");
        expect(resume[0].status).toBe("resolved");
        expect(resume[0].payload.answers?.length).toBeGreaterThan(0);
    });

    test("C-5: resolved interrupt renders the 'Decision recorded' summary on reopen (D-08, WR-01)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 305, conversationId: 305, title: "Decision Replay Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "interrupt";
        agui.registerThread(String(t.conversationId));

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        // Answer the decision; submit. The resume run completes NORMALLY
        // (quick script — like the real server, whose follow-up run finishes
        // with success and clears the clone's pending interrupts), so the
        // card disappears after submit.
        const decisionCard = page.locator('[data-testid="decision-card"]');
        await expect(decisionCard).toBeVisible({ timeout: 10_000 });
        await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
        await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();
        agui.script = "quick";
        await page.locator('[data-testid="decision-submit"]').click();
        await expect(decisionCard).not.toBeVisible({ timeout: 10_000 });

        // Reopen: the connect replay (script "interrupt") re-pends the
        // interrupt outcome; the bridge handler replays the recorded outcome
        // as the collapsed summary (WR-01 — the previously dead D-08 branch
        // is now reachable). The recorded outcome is SPA-session scoped, so
        // this exact flow renders the summary instead of the pending card.
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });
        agui.script = "interrupt";
        await openTaskDrawer(page, t.id);
        const replayedCard = page.locator('[data-testid="decision-card"]');
        await expect(replayedCard).toContainText("Decision recorded", { timeout: 10_000 });
        await expect(replayedCard).toContainText("2 answers recorded");
    });
});

// ─── Suite L — chat thread sidebar (ChatThreadSidebar) ────────────────────────

test.describe("L — chat thread sidebar", () => {
    test("L-1: sidebar lists sessions from chatSessions.list with thread-item rows", async ({ page, api }) => {
        const s1 = makeChatSession({ id: 501, title: "Session Alpha" });
        const s2 = makeChatSession({ id: 502, title: "Session Beta" });
        api.returns("chatSessions.list", [s1, s2]);

        await page.goto("/");
        await openSidebar(page);

        // The sidebar data source (planner decision, Research Open Question
        // 1/A8): chatSessions.list via chatStore — session-only rows.
        const row1 = page.locator('[data-testid="thread-item-501"]');
        const row2 = page.locator('[data-testid="thread-item-502"]');
        await expect(row1).toBeVisible({ timeout: 5_000 });
        await expect(row1).toContainText("Session Alpha");
        await expect(row2).toBeVisible();
        await expect(row2).toContainText("Session Beta");

        // Status dot class follows the session status.
        await expect(row1.locator(".session-item__status-dot.status-dot--idle")).toBeVisible();
    });

    test("L-2: New Session creates via chatSessions.create and opens the drawer", async ({ page, api }) => {
        const created = makeChatSession({ id: 510, title: "New Chat" });
        const createCalls = api.capture("chatSessions.create", created);

        await page.goto("/");
        await openSidebar(page);

        await page.locator('[data-testid="thread-new"]').click();

        // chatSessions.create fired (with the active workspace key) and the
        // new session row appears; selecting it opens the session drawer.
        await expect.poll(() => createCalls.length).toBeGreaterThan(0);
        expect(createCalls[0]).toMatchObject({ workspaceKey: "test-workspace" });
        await expect(page.locator('[data-testid="thread-item-510"]')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });
    });

    test("L-3: Legacy Import triggers legacyImport.run; success, idempotent and failure toasts", async ({ page, api }) => {
        const importCalls = api.capture("legacyImport.run", {
            total: 3, imported: 3, skipped: 0, failed: 0, errors: [],
        });

        await page.goto("/");
        await openSidebar(page);

        const importBtn = page.locator('[data-testid="legacy-import-btn"]');
        await expect(importBtn).toBeVisible();

        // First run: imported > 0 → completion toast (IMPR-01).
        await importBtn.click();
        await expect.poll(() => importCalls.length).toBeGreaterThan(0);
        await expect(page.locator(".p-toast")).toContainText("Import complete", { timeout: 5_000 });
        await expect(page.locator(".p-toast")).toContainText("Imported 3 conversations");

        // Idempotent re-run (IMPR-02): everything skipped → info toast, and
        // the button stays re-runnable.
        api.returns("legacyImport.run", { total: 3, imported: 0, skipped: 3, failed: 0, errors: [] });
        await importBtn.click();
        await expect(page.locator(".p-toast")).toContainText("Already imported", { timeout: 5_000 });
        await expect(page.locator(".p-toast")).toContainText("no duplicates");

        // Failure: failed > 0 → error toast with the error detail; the
        // action remains re-runnable (no permanent error state).
        api.returns("legacyImport.run", { total: 2, imported: 0, skipped: 0, failed: 2, errors: ["boom"] });
        await importBtn.click();
        await expect(page.locator(".p-toast")).toContainText("Import failed", { timeout: 5_000 });
        await expect(page.locator(".p-toast")).toContainText("boom");
        await expect(importBtn).toBeEnabled();
    });

    test("L-4: empty session list renders the empty-state copy with New session active", async ({ page, api }) => {
        api.returns("chatSessions.list", []);

        await page.goto("/");
        await openSidebar(page);

        const empty = page.locator('[data-testid="thread-empty"]');
        await expect(empty).toBeVisible({ timeout: 5_000 });
        await expect(empty).toContainText("No sessions yet");
        await expect(empty).toContainText("Start a new session to begin.");

        // New session button remains visible and active (Copywriting Contract).
        const newBtn = page.locator('[data-testid="thread-new"]');
        await expect(newBtn).toBeVisible();
        await expect(newBtn).toBeEnabled();
    });
});
