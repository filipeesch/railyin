/**
 * stream-reactivity.spec.ts — migrated onto the agui fixture (plan 06-04).
 *
 * The legacy ws.pushStreamEvent floods, hand-rolled StreamEvent builders,
 * `.conv-body` scroll asserts, and writtenFiles seeds are GONE. Live intents
 * stream from the canonical fixture scripts (quick / toolcall); ordered
 * history intents use registerHistory (the 06-01 multi-message knob);
 * autoscroll intents assert the CopilotChat scroll container
 * ([data-testid="copilot-chat-view-scroll"] — overflow-y-scroll, verified in
 * the installed bundle; the `.railyn-chat` wrapper is not the scroller,
 * threat T-06-15).
 *
 * Retired in-file:
 *   B-2 — data-stream-version: the attribute was a legacy ConversationBody
 *         stream-block marker; the CopilotKit surface has no such attribute
 *         (feature removed with the legacy stack).
 *   F-2 — status_chunk: status/status_chunk is in the FEATURES.md trim list
 *         (removed feature); the reasoning script covers status-ish display
 *         via the Thinking card (C-2, chat-copilotkit.spec.ts).
 */
import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { chatTextarea, submitChatMessage, collectConnectRequests } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { HistoryMessage } from "./fixtures/mock-agui";
import type { Page, Locator } from "@playwright/test";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The CopilotChat scroll container — the actual scroller (T-06-15). */
function chatScroll(page: Page): Locator {
    return page.locator('[data-testid="copilot-chat-view-scroll"]');
}

/** Pixels between the viewport bottom and the scroll container's content bottom. */
async function distFromBottom(scroll: Locator): Promise<number> {
    return scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
}

/** Ordered assistant-message history for registerHistory (multi-message floods). */
function historyFlood(count: number, prefix = "Baseline"): HistoryMessage[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `h${i}`,
        role: "assistant",
        content: `${prefix} line ${i + 1}: ${"x".repeat(60)}\n`,
    }));
}

/** Scroll the chat to a pixel offset and dispatch the scroll event the browser would. */
async function scrollChatTo(scroll: Locator, top: number): Promise<void> {
    await scroll.evaluate((el, t) => {
        el.scrollTop = t;
        el.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, top);
}

// ─── Suite A — Live streaming ──────────────────────────────────────────────────

test.describe("A — Live streaming", () => {
    test("A-1: streamed text chunks concatenate into a single assistant message", async ({ page, api, agui }) => {
        const t = makeTask({ id: 101, conversationId: 101, title: "Streaming Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        // The fixture streams the full quick sequence through POST /run — the
        // legacy 5-chunk flood intent: the streamed text renders progressively
        // and merges into ONE assistant message row.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await submitChatMessage(page, "stream this please");
        await expect(chat).toContainText("stream this please", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
        await expect(chat.locator('[data-message-id="m1"]')).toHaveCount(1);
        await expect(chat.locator('[data-message-id="m1"]')).toContainText("hello");
    });

    test("A-2: tool_call event renders the shell tool block with its command", async ({ page, api, agui }) => {
        const t = makeTask({ id: 102, conversationId: 102, title: "Tool Block Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "run a command");

        // The toolcall fixture's bash tool renders the ShellOutputRenderer card
        // with the command in the header (legacy .tc__tool-name intent).
        const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
        await expect(bashCard).toBeVisible({ timeout: 10_000 });
        await expect(bashCard).toContainText("ls -la");
    });

    test("A-3: tool block header renders the humanized command, not raw JSON", async ({ page, api, agui }) => {
        const t = makeTask({ id: 103, conversationId: 103, title: "Humanized Label Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        await submitChatMessage(page, "inspect the repo");

        // Humanized-label intent: the card header shows the tool name + the
        // command as readable text — never the raw JSON args envelope.
        const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
        await expect(bashCard).toBeVisible({ timeout: 10_000 });
        await expect(bashCard).toContainText("bash");
        await expect(bashCard).toContainText("ls -la");
        await expect(bashCard).not.toContainText('"command"');
    });
});

// ─── Suite B — Rendering isolation ────────────────────────────────────────────

test.describe("B — Rendering isolation", () => {
    test("B-1: background board events do not mutate the active task's chat DOM", async ({ page, api, ws }) => {
        const task1 = makeTask({ id: 1, conversationId: 1 });
        const task2 = makeTask({ id: 2, conversationId: 2 });
        api.handle("tasks.list", () => [task1, task2]);

        await page.goto("/");
        await openTaskDrawer(page, task1.id);
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(200); // let the initial mount settle before observing

        // Attach a MutationObserver to the live chat surface (the legacy
        // .conv-body observer target no longer exists — the isolation intent
        // is unchanged: background activity must not touch the active chat DOM).
        await page.evaluate(() => {
            const view = document.querySelector('[data-testid="copilot-chat-view"]');
            let count = 0;
            const obs = new MutationObserver(() => count++);
            if (view) obs.observe(view, { subtree: true, childList: true, characterData: true });
            (window as unknown as Record<string, unknown>).__chatMutCount = () => {
                obs.disconnect();
                return count;
            };
        });

        // Positive proof: task.updated with terminal state → task2 gets unread dot.
        ws.push({ type: "task.updated", payload: makeTask({ id: task2.id, executionState: "completed" }) });
        await expect(
            page.locator(`[data-task-id="${task2.id}"] .task-card__unread-dot`),
        ).toBeVisible({ timeout: 5_000 });

        // Negative proof: the active chat DOM had zero mutations.
        const mutCount = await page.evaluate(
            () => (window as unknown as Record<string, () => number>).__chatMutCount(),
        );
        expect(mutCount).toBe(0);
    });

    // B-2 (data-stream-version) retired in-file: the attribute was a legacy
    // ConversationBody stream-block marker; the CopilotKit surface has no such
    // attribute (feature removed with the legacy stack).
});

// ─── Suite C — History reload on reopen ───────────────────────────────────────

test.describe("C — History reload", () => {
    test("C-1: re-opening the drawer replays the thread history via /connect", async ({ page, api, agui }) => {
        const t = makeTask({ id: 104, conversationId: 104, title: "Reload Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerThread(String(t.conversationId));

        const connectRequests = collectConnectRequests(page);
        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        // Connect replay renders the MESSAGES_SNAPSHOT assistant message.
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // Close and reopen — the prior assistant text must render again via a
        // fresh /connect replay (fresh load from the thread, never stale
        // in-memory blocks — the memory-cleanup intent).
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });

        await openTaskDrawer(page, t.id);
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        expect(connectRequests.length).toBeGreaterThanOrEqual(2);
        expect(connectRequests).toContain(String(t.conversationId));
    });

    test("C-2: each task's drawer shows only its own thread history", async ({ page, api, agui }) => {
        const task1 = makeTask({ id: 1, conversationId: 1 });
        const task2 = makeTask({ id: 2, conversationId: 2 });
        api.handle("tasks.list", () => [task1, task2]);
        // task2 has persisted history (fixture replay); task1 is a never-run thread.
        agui.registerHistory(String(task2.conversationId), [
            { id: "u1", role: "user", content: "background task question" },
            { id: "a1", role: "assistant", content: "persisted response" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, task1.id);

        // task1 (never-run) renders the empty state — nothing from task2 leaks in.
        const chat1 = page.locator('[data-testid="copilot-chat-view"]');
        await expect(page.locator('[data-testid="chat-empty-state"]')).toBeVisible({ timeout: 10_000 });
        await expect(chat1).not.toContainText("persisted response");

        // Open task2: its own persisted history replays — not task1's state.
        await page.locator(`[data-task-id="${task2.id}"]`).click();
        await expect(page.locator(".task-detail")).toBeVisible();
        const chat2 = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat2).toContainText("persisted response", { timeout: 10_000 });
        await expect(chat2).not.toContainText("No messages yet");
    });
});

// ─── Suite D — Unread state ────────────────────────────────────────────────────

test.describe("D — Unread state", () => {
    // D-1 stays byte-identical (green, untouched — board-surface only).
    test("D-1: task.updated with terminal state gives task2 unread dot; opening task2 clears it", async ({
        page,
        api,
        ws,
    }) => {
        const task1 = makeTask({ id: 1, conversationId: 1 });
        const task2 = makeTask({ id: 2, conversationId: 2 });
        api.handle("tasks.list", () => [task1, task2]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openTaskDrawer(page, task1.id);

        // Push task.updated with terminal executionState for task2 (background) — this marks it unread
        ws.push({
            type: "task.updated",
            payload: makeTask({ id: task2.id, executionState: "completed" }),
        });

        // Task2 card should have unread dot
        await expect(
            page.locator(`[data-task-id="${task2.id}"] .task-card__unread-dot`),
        ).toBeVisible({ timeout: 5_000 });

        // Open task2 — unread dot should disappear
        await page.locator(`[data-task-id="${task2.id}"]`).click();
        await expect(page.locator(".task-detail")).toBeVisible();
        await expect(
            page.locator(`[data-task-id="${task2.id}"] .task-card__unread-dot`),
        ).not.toBeVisible({ timeout: 3_000 });
    });
});

// ─── Suite E — Auto-scroll (CopilotChat scroll container) ─────────────────────

test.describe("E — Auto-scroll", () => {
    test("E-1: history flood overflows the scroll container and stays at bottom", async ({ page, api, agui }) => {
        const t = makeTask({ id: 105, conversationId: 105, title: "Autoscroll Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerHistory(String(t.conversationId), historyFlood(20));

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Baseline line 20", { timeout: 10_000 });

        const scroll = chatScroll(page);
        const info = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
        if (info.sh < info.ch + 100) {
            test.skip();
            return;
        }

        // Auto-scroll engages on mount: viewport pinned at the bottom, and the
        // scroll-to-bottom affordance stays hidden.
        await expect
            .poll(() => distFromBottom(scroll), { timeout: 3_000 })
            .toBeLessThan(60);
        await expect(page.locator('[data-testid="copilot-chat-view-scroll-to-bottom"]')).toHaveCount(0);
    });

    test("E-2: background board events do not move the active task's scroll position", async ({ page, api, agui, ws }) => {
        const task1 = makeTask({ id: 1, conversationId: 1 });
        const task2 = makeTask({ id: 2, conversationId: 2 });
        api.handle("tasks.list", () => [task1, task2]);
        agui.registerHistory(String(task1.conversationId), historyFlood(15));

        await page.goto("/");
        await openTaskDrawer(page, task1.id);

        const scroll = chatScroll(page);
        const info = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
        if (info.sh < info.ch + 100) {
            test.skip();
            return;
        }

        // User scrolls up to read — capture the position.
        await scrollChatTo(scroll, 0);
        await page.waitForTimeout(100);
        const scrollBefore = await scroll.evaluate((el) => el.scrollTop);

        // Background task2 activity (board event) arrives.
        ws.push({ type: "task.updated", payload: makeTask({ id: task2.id, executionState: "completed" }) });
        await page.waitForTimeout(300);

        // task1's scroll must not have changed.
        const scrollAfter = await scroll.evaluate((el) => el.scrollTop);
        expect(scrollAfter).toBe(scrollBefore);
    });

    test("E-3: autoscroll disengages when the user scrolls up during streaming", async ({ page, api, agui }) => {
        const t = makeTask({ id: 106, conversationId: 106, title: "Disengage Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerHistory(String(t.conversationId), historyFlood(20));

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Baseline line 20", { timeout: 10_000 });
        const scroll = chatScroll(page);
        const info = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
        if (info.sh < info.ch + 100) {
            test.skip();
            return;
        }

        // User scrolls up — autoscroll must disengage (button appears).
        await scrollChatTo(scroll, 0);
        await expect(page.locator('[data-testid="copilot-chat-view-scroll-to-bottom"]')).toBeVisible({
            timeout: 3_000,
        });
        const distBefore = await distFromBottom(scroll);
        expect(distBefore).toBeGreaterThan(100);

        // A new run streams while the user is scrolled up — the viewport must
        // NOT be dragged back to the bottom.
        await submitChatMessage(page, "stream more");
        await expect(chat).toContainText("stream more", { timeout: 10_000 });
        await expect.poll(() => agui.runInputs.length).toBe(1);
        await page.waitForTimeout(800); // let the stream + terminal settle

        const distAfter = await distFromBottom(scroll);
        expect(distAfter).toBeGreaterThan(100);
        await expect(page.locator('[data-testid="copilot-chat-view-scroll-to-bottom"]')).toBeVisible();
    });

    test("E-4: autoscroll re-engages when the user scrolls back to the bottom", async ({ page, api, agui }) => {
        const t = makeTask({ id: 107, conversationId: 107, title: "Re-engage Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerHistory(String(t.conversationId), historyFlood(20));

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Baseline line 20", { timeout: 10_000 });
        const scroll = chatScroll(page);
        const info = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
        if (info.sh < info.ch + 100) {
            test.skip();
            return;
        }

        // User scrolls up, then back to the bottom (re-engagement).
        await scrollChatTo(scroll, 0);
        await page.waitForTimeout(100);
        await scrollChatTo(scroll, info.sh);
        await expect(page.locator('[data-testid="copilot-chat-view-scroll-to-bottom"]')).toHaveCount(0, {
            timeout: 3_000,
        });

        // New content arrives while pinned at the bottom — autoscroll keeps the
        // viewport at the bottom.
        await submitChatMessage(page, "stream more");
        await expect(chat).toContainText("stream more", { timeout: 10_000 });
        await expect.poll(() => agui.runInputs.length).toBe(1);
        await page.waitForTimeout(800);

        const distAfter = await distFromBottom(scroll);
        expect(distAfter).toBeLessThanOrEqual(60);
        await expect(page.locator('[data-testid="copilot-chat-view-scroll-to-bottom"]')).toHaveCount(0);
    });

    test("E-5: reading position stays stable while streaming below the fold", async ({ page, api, agui }) => {
        const t = makeTask({ id: 108, conversationId: 108, title: "Reading Position Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerHistory(String(t.conversationId), historyFlood(30));

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Baseline line 30", { timeout: 10_000 });
        const scroll = chatScroll(page);
        const info = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
        if (info.sh < info.ch + 100) {
            test.skip();
            return;
        }

        // User scrolls to mid-history to read.
        const midPosition = Math.floor(info.sh * 0.4);
        await scrollChatTo(scroll, midPosition);
        await page.waitForTimeout(100);
        const scrollTopBefore = await scroll.evaluate((el) => el.scrollTop);
        expect(info.sh - scrollTopBefore - info.ch).toBeGreaterThan(50); // not at the bottom

        // A run streams below the fold — the reading position must not drift.
        await submitChatMessage(page, "stream below the fold");
        await expect(chat).toContainText("stream below the fold", { timeout: 10_000 });
        await expect.poll(() => agui.runInputs.length).toBe(1);
        await page.waitForTimeout(800);

        const scrollTopAfter = await scroll.evaluate((el) => el.scrollTop);
        expect(Math.abs(scrollTopAfter - scrollTopBefore)).toBeLessThanOrEqual(5);
    });

    test("E-6: an upward wheel near the bottom does not snap the viewport back", async ({ page, api, agui }) => {
        const t = makeTask({ id: 109, conversationId: 109, title: "Wheel Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerHistory(String(t.conversationId), historyFlood(20));

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Baseline line 20", { timeout: 10_000 });
        const scroll = chatScroll(page);
        const info = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
        if (info.sh < info.ch + 100) {
            test.skip();
            return;
        }

        // User wheels up from the bottom — the scroll position moves just past
        // the autoscroll threshold (12px, CopilotChatView) and stays there.
        await scroll.evaluate((el) => {
            el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 60);
            el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event("scroll", { bubbles: true }));
        });
        await page.waitForTimeout(100);
        const distBefore = await distFromBottom(scroll);
        expect(distBefore).toBeGreaterThan(20);

        // New content arrives — the viewport must NOT be snapped back to the bottom.
        await submitChatMessage(page, "stream after wheel");
        await expect(chat).toContainText("stream after wheel", { timeout: 10_000 });
        await expect.poll(() => agui.runInputs.length).toBe(1);
        await page.waitForTimeout(800);

        const distAfter = await distFromBottom(scroll);
        expect(distAfter).toBeGreaterThan(20);
    });

    test("E-7: scroll stays at bottom after the stream ends and persisted history arrives", async ({ page, api, agui }) => {
        const t = makeTask({ id: 110, conversationId: 110, title: "End-of-Stream Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerHistory(String(t.conversationId), historyFlood(20));

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Baseline line 20", { timeout: 10_000 });
        const scroll = chatScroll(page);
        const info = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
        if (info.sh < info.ch + 100) {
            test.skip();
            return;
        }

        // Run a stream; when it finishes the viewport must still be at the bottom.
        await submitChatMessage(page, "stream to completion");
        await expect(chat).toContainText("stream to completion", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
        await expect.poll(() => distFromBottom(scroll), { timeout: 3_000 }).toBeLessThan(60);

        // Reopen: the persisted history replays (connect) — still at the bottom.
        await page.keyboard.press("Escape");
        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });
        await openTaskDrawer(page, t.id);
        await expect(chat).toContainText("Baseline line 20", { timeout: 10_000 });
        await expect.poll(() => distFromBottom(scroll), { timeout: 3_000 }).toBeLessThan(60);
    });
});

// ─── Suite F — Progressive streaming ──────────────────────────────────────────

test.describe("F — Progressive streaming", () => {
    test("F-1: the user turn renders before the streamed assistant text", async ({ page, api, agui }) => {
        const t = makeTask({ id: 111, conversationId: 111, title: "Progressive Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "quick";

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        // Per-token interleaving is not fixture-producible (the fixture streams
        // the complete sequence); the progressive intent — the user message
        // renders first, then the assistant stream appears — holds: assert the
        // user turn, then the streamed assistant text.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await submitChatMessage(page, "tokens please");
        await expect(chat).toContainText("tokens please", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
        await expect(chat.locator('[data-message-id="m1"]')).toContainText("hello");
    });

    // F-2 (status_chunk) retired in-file: status/status_chunk is in the
    // FEATURES.md trim list (removed feature); the reasoning script covers
    // status-ish display via the Thinking card (C-2).
});

// ─── Suite G — tool result stat rendering ─────────────────────────────────────

test.describe("G — tool result stat rendering", () => {
    test("G-1: the write tool card shows +N stats derived from the result payload", async ({ page, api, agui }) => {
        const t = makeTask({ id: 112, conversationId: 112, title: "Write Stats Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        // Legacy writtenFiles-seeded +N/−M assertions are gone (T-06-18): the
        // stats derive from the canonical toolcall fixture's write_file call
        // (args-derived payload, FileChangesRenderer).
        await submitChatMessage(page, "write the changes");

        const writeCard = page.locator('[data-testid="tool-card-tc-write"]');
        await expect(writeCard).toBeVisible({ timeout: 10_000 });
        await expect(writeCard).toContainText("src/auth.ts");
        await expect(writeCard.locator(".fc__stat--added")).toContainText("+2");
    });

    test("G-2: stat chips render from the payload derivation with no phantom removed chip", async ({ page, api, agui }) => {
        const t = makeTask({ id: 113, conversationId: 113, title: "Combined Stats Task" });
        api.handle("tasks.list", () => [t]);
        agui.script = "toolcall";

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await expect(chatTextarea(page)).toBeEnabled({ timeout: 10_000 });

        // Multiple-writtenFiles combined stats were seed-driven (legacy);
        // the canonical fixture's single write_file (added 2, removed 0) now
        // drives the derivation — the added chip renders, the removed chip
        // must not (zero-removal payload).
        await submitChatMessage(page, "batch the edits");

        const writeCard = page.locator('[data-testid="tool-card-tc-write"]');
        await expect(writeCard).toBeVisible({ timeout: 10_000 });
        await expect(writeCard.locator(".fc__stat--added")).toContainText("+2");
        await expect(writeCard.locator(".fc__stat--removed")).toHaveCount(0);
    });
});
