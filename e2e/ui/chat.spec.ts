/**
 * chat.spec.ts — UI tests for task chat / conversation.
 *
 * Suites:
 *   M — basic send & streaming
 *   N — execution state
 *   O — persistence and multi-turn ordering
 *
 * Migrated onto the agui fixture (Phase 6, plan 06-03): all chat traffic
 * flows through POST /agent/default/run|connect|stop (/api/copilotkit/*)
 * served by MockAgui; assertions target the CopilotKit surface
 * ([data-testid="copilot-chat-view"]). N-5/N-7 keep the [data-task-id]
 * exec-* task-card class assertions (board surface — untouched by the chat
 * swap); N-9's queue-button half is retired in-file (queue UI removed —
 * Research Open Question 5; UI-SPEC "no queue affordance").
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, chatTextarea, submitChatMessage, collectConnectRequests } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { Task } from "@shared/rpc-types";

// ─── Suite M — basic send & streaming ────────────────────────────────────────

test.describe("M — basic send & streaming", () => {
    test("M-1: user message appears immediately in the chat view after send", async ({ page, api }) => {
        const t = makeTask({ id: 101, conversationId: 101, title: "M-1 Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await expect(chatTextarea(page)).toBeEnabled();

        await submitChatMessage(page, "Hello from M-1");

        // The user message renders (RUN_STARTED carries the run input).
        await expect(chat).toContainText("Hello from M-1", { timeout: 10_000 });
    });

    test("M-2: assistant text streams into the chat view while the run is in progress", async ({ page, api, agui }) => {
        const t = makeTask({ id: 102, conversationId: 102, title: "M-2 Task" });
        api.handle("tasks.list", () => [t]);
        // Slow variant: the fixture holds the /run response open (terminal-less
        // body) so the run stays isRunning while the streamed text renders —
        // the legacy streaming-bubble intent (S-1 pattern).
        agui.script = "slow";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "M-2 msg");

        // The run stays isRunning while the fixture holds the response open —
        // the stop button renders during the streaming window…
        await expect(page.locator('[data-testid="stop-btn"]')).toBeVisible({ timeout: 5_000 });

        // …and the partial streamed text renders into the chat view.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("working on it", { timeout: 10_000 });
    });

    test("M-3: assistant message persisted after streaming ends", async ({ page, api }) => {
        const t = makeTask({ id: 103, conversationId: 103, title: "M-3 Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "M-3 msg");

        // The quick script streams the assistant text and completes with
        // RUN_FINISHED — the assistant message persists in the chat view.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("hello", { timeout: 10_000 });
        await expect(chat.locator('[data-testid="copilot-assistant-message"]')).toHaveCount(1);
    });

    test("M-4: assistant message content matches streamed text", async ({ page, api }) => {
        const t = makeTask({ id: 104, conversationId: 104, title: "M-4 Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "M-4 msg");

        // The streamed assistant content (quick script "hello") matches the
        // rendered assistant message text.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat.locator('[data-testid="copilot-assistant-message"]').last()).toContainText("hello", { timeout: 10_000 });
    });
});

// ─── Suite N — execution state ────────────────────────────────────────────────

test.describe("N — execution state in the UI", () => {
    test("N-5: task card gets .exec-running class while streaming", async ({ page, api, ws, agui }) => {
        const t = makeTask({ id: 105, conversationId: 105, title: "N-5 Task" });
        const runningTask: Task = { ...t, executionState: "running" };
        const completedTask: Task = { ...t, executionState: "completed" };
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "N-5 msg");

        // The chat streams (quick script) while the card reflects the running
        // state. The exec-* class assertion is board surface (D-03) — driven
        // by the WebSocket task.updated event, untouched by the chat swap.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        ws.push({ type: "task.updated", payload: runningTask });
        await expect(page.locator(`[data-task-id="${t.id}"]`)).toHaveClass(/exec-running/, { timeout: 5_000 });

        // Settle
        ws.push({ type: "task.updated", payload: completedTask });
    });

    test("N-6: stop button visible during streaming, send button absent", async ({ page, api, agui }) => {
        const t = makeTask({ id: 106, conversationId: 106, title: "N-6 Task" });
        api.handle("tasks.list", () => [t]);
        // Slow variant: the fixture holds the /run response open so the run
        // stays isRunning until the stop click lands (C-1 pattern).
        agui.script = "slow";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "N-6 msg");

        // Stop button visible while running (replaces the legacy stop icon).
        // The new surface has no send button at all —
        // submission is Enter-based (the queue affordance retired with N-9).
        const stopBtn = page.locator('[data-testid="stop-btn"]');
        await expect(stopBtn).toBeVisible({ timeout: 5_000 });

        await stopBtn.click();

        // The run finalizes client-side (aborted fetch) and the "Stopped"
        // marker renders — pure client state, never derived from wire events.
        const stopped = page.locator('[data-testid="chat-stopped"]');
        await expect(stopped).toBeVisible({ timeout: 10_000 });
        await expect(stopped).toContainText("Stopped");

        // The /stop round-trip hit the fixture for this thread. The POST is
        // recorded when the Playwright route handler executes — poll for it
        // instead of racing the marker render (IN-02).
        await expect
            .poll(() => agui.stopRequests.includes(String(t.conversationId)), { timeout: 3_000 })
            .toBe(true);
    });

    test("N-7: task card gets .exec-completed after streaming ends", async ({ page, api, ws }) => {
        const t = makeTask({ id: 107, conversationId: 107, title: "N-7 Task" });
        const completedTask: Task = { ...t, executionState: "completed" };
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "N-7 msg");

        // The chat stream completes via the quick script; the card follows
        // the execution state pushed over the WebSocket (board surface).
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        ws.push({ type: "task.updated", payload: { ...t, executionState: "running" } });
        await expect(page.locator(`[data-task-id="${t.id}"]`)).toHaveClass(/exec-running/, { timeout: 5_000 });
        ws.push({ type: "task.updated", payload: completedTask });
        await expect(page.locator(`[data-task-id="${t.id}"]`)).toHaveClass(/exec-completed/, { timeout: 10_000 });
    });

    test("N-8: empty editor cannot submit a run", async ({ page, api, agui }) => {
        const t = makeTask({ id: 108, conversationId: 108, title: "N-8 Task" });
        api.handle("tasks.list", () => [t]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        // The empty editor is ready for input (replaces the legacy editor
        // visibility). The surface has no send button — the
        // submit affordance is Enter (CopilotChatInput trims empty values).
        const input = chatTextarea(page);
        await expect(input).toBeEnabled({ timeout: 10_000 });

        await input.click();
        await page.keyboard.press("Enter");

        // Empty submit attempts never reach the agent — zero /run requests.
        // Bound the negative window: a buggy submit is recorded by the route
        // handler ASYNCHRONOUSLY (browser → Playwright route dispatch → push),
        // so give any stray /run time to arrive before asserting absence
        // (WR-02 — a bare poll passes immediately when the count is already 0).
        await page.waitForTimeout(500);
        expect(agui.runInputs).toHaveLength(0);
    });

    test("N-9: editor stays enabled while AI is running (queue button half retired)", async ({ page, api, agui }) => {
        const t = makeTask({ id: 109, conversationId: 109, title: "N-9 Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "slow";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "N-9 msg");

        // Editor stays enabled while the AI is running — the run stays
        // isRunning under the slow script (only a pending interrupt disables
        // the input, CHAT-09). RETIRED HALF (in-file): the legacy
        // queue-button/send-button swap — the queue UI is removed (Research
        // Open Question 5; UI-SPEC "no queue affordance" — the queue
        // affordance only existed in the dead ConversationInput).
        const input = chatTextarea(page);
        await expect(page.locator('[data-testid="stop-btn"]')).toBeVisible({ timeout: 5_000 });
        await expect(input).toBeEnabled();

        // Stop ends the run; the editor remains enabled for the next message.
        await page.locator('[data-testid="stop-btn"]').click();
        await expect(page.locator('[data-testid="chat-stopped"]')).toBeVisible({ timeout: 10_000 });
        await expect(input).toBeEnabled();
    });
});

// ─── Suite O — persistence and multi-turn ordering ───────────────────────────

test.describe("O — persistence and multi-turn ordering", () => {
    test("O-9: messages survive drawer close and reopen", async ({ page, api, agui }) => {
        const t = makeTask({ id: 110, conversationId: 110, title: "O-9 Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerThread(String(t.conversationId));

        const connectRequests = collectConnectRequests(page);
        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        // Connect replay renders the MESSAGES_SNAPSHOT assistant message.
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // Close drawer, reopen — the prior assistant text must render again
        // via the /connect replay (S-2 pattern).
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        await openTaskDrawer(page, t.id);
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // The second open triggered a fresh POST /agent/default/connect for
        // the task's threadId (the history replay chain).
        expect(connectRequests.length).toBeGreaterThanOrEqual(2);
        expect(connectRequests).toContain(String(t.conversationId));
    });

    test("O-10: two round-trips produce 4 messages in correct order", async ({ page, api, agui }) => {
        const t = makeTask({ id: 111, conversationId: 111, title: "O-10 Task" });
        api.handle("tasks.list", () => [t]);
        // Ordered multi-message history replay (registerHistory knob): the
        // connect MESSAGES_SNAPSHOT carries the alternating user/assistant
        // history verbatim, order preserved.
        agui.registerHistory(String(t.conversationId), [
            { id: "u1", role: "user", content: "Round 1" },
            { id: "a1", role: "assistant", content: "Reply 1" },
            { id: "u2", role: "user", content: "Round 2" },
            { id: "a2", role: "assistant", content: "Reply 2" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        const userMsgs = chat.locator('[data-testid="copilot-user-message"]');
        const assistantMsgs = chat.locator('[data-testid="copilot-assistant-message"]');
        await expect(userMsgs).toHaveCount(2, { timeout: 10_000 });
        await expect(assistantMsgs).toHaveCount(2);

        // Order: user → assistant → user → assistant.
        await expect(userMsgs.nth(0)).toContainText("Round 1");
        await expect(assistantMsgs.nth(0)).toContainText("Reply 1");
        await expect(userMsgs.nth(1)).toContainText("Round 2");
        await expect(assistantMsgs.nth(1)).toContainText("Reply 2");
    });

    test("O-11: no duplicate messages after drawer reopen", async ({ page, api, agui }) => {
        const t = makeTask({ id: 112, conversationId: 112, title: "O-11 Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerThread(String(t.conversationId));

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat.locator('[data-testid="copilot-assistant-message"]')).toHaveCount(1, { timeout: 10_000 });

        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });
        await openTaskDrawer(page, t.id);

        // Still exactly 1 assistant message — no duplicates on reopen.
        await expect(chat.locator('[data-testid="copilot-assistant-message"]')).toHaveCount(1, { timeout: 10_000 });
    });
});
