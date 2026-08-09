/**
 * chat-session-drawer.spec.ts — UI tests for the session ConversationDrawer.
 *
 * Suites:
 *   CD-A — Opening and rendering
 *   CD-B — Sending messages
 *   CD-C — Streaming and execution state
 *   CD-D — waiting_user states
 *   CD-E — Persistence and ordering
 *   CD-F — Drawer lifecycle (outside-click, loading spinner, close clears state)
 *   CD-I — Edge cases (blank rename, WS dedup, replace open session)
 *   CD-J — Action execution (stop/abort, archive)
 *   CD-L — Tool-call rendering regression guard
 *
 * Migrated onto the agui fixture (Phase 6, plan 06-05): the session drawer's
 * chat is now the CopilotKit surface (SessionChatView.vue renders RailyinChat
 * with threadId = conversationId), so the red session-chat tests were
 * rewritten onto the S-1/S-2/C-1 patterns (chat-copilotkit.spec.ts) scoped to
 * .session-chat-view, with NEW INLINE session variants of the chat helpers
 * (chatTextareaSession / submitChatMessageSession) — the shared task-drawer
 * helpers stay untouched (Pitfall 3). In-file retires (A-6/G-1..3/H-2 model
 * selector, D-6 submitDecisions, K-1/K-2 file chips, C-6 status_chunk) are
 * recorded with rationale in 06-05-SUMMARY.md. The 19 already-green tests
 * stayed byte-identical.
 *
 * Backend is fully mocked via ApiMock + WsMock + MockAgui fixtures.
 */

import { test, expect, openSidebar, openSessionDrawer } from "./fixtures";
import { makeChatSession, makeChatMessage } from "./fixtures/mock-data";
import type { Page } from "@playwright/test";
import type { ApiMock } from "./fixtures/mock-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stubSessionMessages(api: ApiMock, conversationId: number, messages: ReturnType<typeof makeChatMessage>[]) {
    api.handle("conversations.getMessages", ({ conversationId: requestedConversationId }) => ({
        messages: requestedConversationId === conversationId ? [...messages] : [],
        hasMore: false,
    }));
}

/** The CopilotChat root inside the session drawer's RailyinChat. */
function sessionChat(page: Page) {
    return page.locator(".session-chat-view [data-testid='copilot-chat-view']");
}

/** The CopilotChatInput textarea inside the session drawer's RailyinChat. */
function chatTextareaSession(page: Page) {
    return page.locator(".session-chat-view [data-testid='chat-input'] textarea");
}

/** Type + Enter in the session chat input (S-1 pattern, session-scoped). */
async function submitChatMessageSession(page: Page, text: string): Promise<void> {
    const input = chatTextareaSession(page);
    await input.click();
    await input.pressSequentially(text);
    await page.keyboard.press("Enter");
}

// ─── Suite CD-A — Opening and rendering ───────────────────────────────────────

test.describe("CD-A — Opening and rendering", () => {
    test("CD-A-1: clicking session in sidebar opens .session-chat-view", async ({ page, api }) => {
        const session = makeChatSession({ id: 400, title: "My Session" });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".session-chat-view")).toBeVisible();
    });

    test("CD-A-2: session title appears in drawer header", async ({ page, api }) => {
        const session = makeChatSession({ id: 401, title: "Named Session" });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".scv-header__title, .session-chat-view [data-testid='session-title']")).toContainText("Named Session");
    });

    test("CD-A-3: no tab switcher visible in session drawer (tabs are task-only)", async ({ page, api }) => {
        const session = makeChatSession({ id: 402 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // PrimeVue TabList should NOT be present in session mode
        await expect(page.locator(".session-chat-view .p-tablist, .session-chat-view [role='tablist']")).toHaveCount(0);
    });

    test("CD-A-4: prior messages render from the thread replay", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 403 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        // S-2 pattern: the connect replay's MESSAGES_SNAPSHOT carries the
        // prior session history (fixture-driven, CHAT-07).
        agui.registerHistory(String(session.conversationId), [
            { id: "u1", role: "user", content: "Hello!" },
            { id: "a1", role: "assistant", content: "Hi there!" },
        ]);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const chat = sessionChat(page);
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await expect(chat).toContainText("Hello!", { timeout: 10_000 });
        await expect(chat).toContainText("Hi there!");
    });

    test("CD-A-5: archive button is visible in drawer header", async ({ page, api }) => {
        const session = makeChatSession({ id: 404 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".scv-header__archive-btn, .session-chat-view [data-action='archive']")).toBeVisible();
    });
});

// ─── Suite CD-B — Sending messages ────────────────────────────────────────────

test.describe("CD-B — Sending messages", () => {
    test("CD-B-1: typing and pressing Enter streams the message via /run", async ({ page, api }) => {
        const session = makeChatSession({ id: 410 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const chat = sessionChat(page);
        await expect(chat).toBeVisible({ timeout: 10_000 });
        await expect(chatTextareaSession(page)).toBeEnabled();

        await submitChatMessageSession(page, "Test message");

        await expect(chat).toContainText("Test message", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 }); // quick-script text
    });

    test("CD-B-2: Shift+Enter inserts newline rather than sending", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 411 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const input = chatTextareaSession(page);
        await expect(input).toBeEnabled({ timeout: 10_000 });
        await input.click();
        await input.pressSequentially("Line 1");
        await page.keyboard.press("Shift+Enter");

        // No /run fired — Shift+Enter is a newline, not a submit. Bound the
        // negative window: a buggy submit is recorded by the route handler
        // asynchronously, so give it time to arrive before asserting absence
        // (WR-02).
        await page.waitForTimeout(500);
        expect(agui.runInputs).toHaveLength(0);
        await expect(input).toHaveValue(/Line 1/);
    });

    test("CD-B-3: pressing Enter with an empty editor sends nothing", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 412 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const input = chatTextareaSession(page);
        await expect(input).toBeEnabled({ timeout: 10_000 });
        await input.click();
        await page.keyboard.press("Enter");

        // Nothing to send — an empty message never fires /run. Bound the
        // negative window (the route handler records asynchronously — WR-02).
        await page.waitForTimeout(500);
        expect(agui.runInputs).toHaveLength(0);
    });

    test("CD-B-4: sending calls the /run endpoint with the message", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 413 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await submitChatMessageSession(page, "API check");

        // The message reaches the AG-UI runtime in the /run request body
        // (the fixture captures every POST /agent/default/run).
        await expect.poll(() => agui.runInputs.length).toBe(1);
        const messages = (agui.runInputs[0] as { messages?: Array<{ content?: string }> }).messages ?? [];
        expect(messages.some((m) => m.content === "API check")).toBe(true);
    });

    test("CD-B-5: can send a second message after the assistant turn completes without reopening the drawer", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 414 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const chat = sessionChat(page);
        await expect(chat).toBeVisible({ timeout: 10_000 });

        await submitChatMessageSession(page, "First message");
        await expect(chat).toContainText("First message", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        await submitChatMessageSession(page, "Second message");
        await expect(chat).toContainText("Second message", { timeout: 10_000 });
        await expect.poll(() => agui.runInputs.length).toBe(2);
    });

    test("CD-B-6: sending a session message does not blank the drawer into loading state", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 415 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        // S-2 pattern: the persisted assistant reply comes from the thread
        // replay — it must survive a subsequent /run without a reload.
        agui.registerHistory(String(session.conversationId), [
            { id: "a1", role: "assistant", content: "Existing reply" },
        ]);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const chat = sessionChat(page);
        await expect(chat).toContainText("Existing reply", { timeout: 10_000 });

        await submitChatMessageSession(page, "No blink");

        await expect(chat).toContainText("No blink", { timeout: 10_000 });
        await expect(chat).toContainText("Existing reply");
        await expect(page.locator('.session-chat-view [data-testid="chat-loading"]')).toHaveCount(0);
    });
});

// ─── Suite CD-C — Streaming and execution state ────────────────────────────────

test.describe("CD-C — Streaming and execution state", () => {
    test("CD-C-1: status badge shows running while session is running", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 420, status: "idle" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Push running status via WS
        ws.pushChatSessionUpdated({ ...session, status: "running" });

        await expect(page.locator(".session-chat-view .scv-status-tag[data-status='running']")).toBeVisible({ timeout: 2_000 });
    });

    test("CD-C-2: the run completes and the chat returns to the idle state", async ({ page, api }) => {
        const session = makeChatSession({ id: 421 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const chat = sessionChat(page);
        await expect(chat).toBeVisible({ timeout: 10_000 });

        await submitChatMessageSession(page, "run it");
        await expect(chat).toContainText("hello", { timeout: 10_000 }); // quick-script text

        // The run is done: no stop affordance remains and the input is usable.
        await expect(page.locator('.session-chat-view [data-testid="stop-btn"]')).not.toBeVisible();
        await expect(chatTextareaSession(page)).toBeEnabled();
    });

    test("CD-C-3: while the session is running the send affordance is replaced by stop", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 422 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        agui.script = "slow"; // terminal-less run — stays isRunning

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await submitChatMessageSession(page, "start something long");

        // Running: the stop button is the active affordance; the legacy
        // send-btn / cancel-btn chrome no longer exists.
        const stopBtn = page.locator('.session-chat-view [data-testid="stop-btn"]');
        await expect(stopBtn).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('.session-chat-view [data-testid="send-btn"]')).not.toBeAttached();
        await expect(page.locator('.session-chat-view [data-testid="cancel-btn"]')).not.toBeAttached();
        await expect(page.locator('.session-chat-view [data-testid="chat-stopped"]')).not.toBeVisible();
    });

    test("CD-C-4: clicking stop aborts the run and renders the Stopped marker", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 423 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        agui.script = "slow";

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await submitChatMessageSession(page, "start something long");

        const stopBtn = page.locator('.session-chat-view [data-testid="stop-btn"]');
        await expect(stopBtn).toBeVisible({ timeout: 5_000 });
        await stopBtn.click();

        const stopped = page.locator('.session-chat-view [data-testid="chat-stopped"]');
        await expect(stopped).toBeVisible({ timeout: 10_000 });
        await expect(stopped).toContainText("Stopped");
        expect(agui.stopRequests).toContain(String(session.conversationId));
    });

    test("CD-C-5: the live /run stream renders in the session conversation body", async ({ page, api }) => {
        const session = makeChatSession({ id: 424 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const chat = sessionChat(page);
        await expect(chat).toBeVisible({ timeout: 10_000 });

        await submitChatMessageSession(page, "Streaming session text");

        await expect(chat).toContainText("Streaming session text", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });
    });

    test("CD-C-5b: persisted history stays ahead of the live session tail in one ordered list", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 4241 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        agui.registerHistory(String(session.conversationId), [
            { id: "a1", role: "assistant", content: "Persisted session answer" },
        ]);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const chat = sessionChat(page);
        await expect(chat).toContainText("Persisted session answer", { timeout: 10_000 });

        await submitChatMessageSession(page, "Live session tail");
        await expect(chat).toContainText("Live session tail", { timeout: 10_000 });
        await expect(chat).toContainText("hello", { timeout: 10_000 });

        // One ordered list: the persisted replay message renders before the
        // live /run tail inside the same CopilotChat message list.
        const texts = await chat.locator("[data-message-id]").evaluateAll((nodes) =>
            nodes.map((n) => n.textContent ?? ""),
        );
        const persistedIdx = texts.findIndex((t) => t.includes("Persisted session answer"));
        const liveIdx = texts.findIndex((t) => t.includes("Live session tail") || t.includes("hello"));
        expect(persistedIdx).toBeGreaterThanOrEqual(0);
        expect(liveIdx).toBeGreaterThan(persistedIdx);
    });
});

// ─── Suite CD-D — waiting_user states ─────────────────────────────────────────

test.describe("CD-D — waiting_user states", () => {
    test("CD-D-1: waiting_user badge shown in drawer header", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 430, status: "idle" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        ws.pushChatSessionUpdated({ ...session, status: "waiting_user" });

        await expect(page.locator(".session-chat-view .scv-status-tag[data-status='waiting_user']")).toBeVisible({ timeout: 2_000 });
    });

    test("CD-D-2: waiting_user session in sidebar shows status-dot--waiting_user", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 431, status: "idle" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSidebar(page);

        ws.pushChatSessionUpdated({ ...session, status: "waiting_user" });

        await expect(page.locator(".status-dot--waiting_user")).toBeVisible({ timeout: 2_000 });
    });

    test("CD-D-3: the chat input is enabled in waiting_user state (user can respond)", async ({ page, api }) => {
        const session = makeChatSession({ id: 432, status: "waiting_user" });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const input = chatTextareaSession(page);
        await expect(input).toBeVisible({ timeout: 10_000 });
        await expect(input).toBeEnabled();
    });

    test("CD-D-4: unread dot shown in sidebar for waiting_user session not yet opened", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 433, lastReadAt: new Date().toISOString() });
        api.returns("chatSessions.list", [session]);

        await page.goto("/");
        await openSidebar(page);

        // Server pushes waiting_user update with null lastReadAt (new activity)
        ws.pushChatSessionUpdated({ ...session, status: "waiting_user", lastReadAt: null });

        await expect(page.locator(".session-item__unread-dot")).toBeVisible({ timeout: 2_000 });
    });

    test("CD-D-5: inline rename in drawer header triggers chatSessions.rename", async ({ page, api }) => {
        const session = makeChatSession({ id: 434, title: "Old Title" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        let renameCalled = false;
        api.handle("chatSessions.rename", () => { renameCalled = true; });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Click on the title to start inline rename
        await page.locator(".scv-header__title, .session-chat-view [data-testid='session-title']").click();
        const input = page.locator(".session-chat-view input[type='text']").first();
        await input.fill("New Title");
        await input.press("Enter");

        // The rename RPC is recorded asynchronously by the route handler —
        // poll for it instead of a fixed settle window (WR-04, Pitfall 5).
        await expect.poll(() => renameCalled, { timeout: 3_000 }).toBe(true);
    });
});

// ─── Suite CD-E — Persistence and ordering ────────────────────────────────────

test.describe("CD-E — Persistence and ordering", () => {
    test("CD-E-1: messages render in chronological order (oldest first)", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 440 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        // S-2 pattern + registerHistory: the replay snapshot preserves order.
        agui.registerHistory(String(session.conversationId), [
            { id: "u1", role: "user", content: "First message" },
            { id: "a1", role: "assistant", content: "Second message" },
        ]);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const chat = sessionChat(page);
        await expect(chat).toContainText("First message", { timeout: 10_000 });

        const texts = await chat.locator("[data-message-id]").evaluateAll((nodes) =>
            nodes.map((n) => n.textContent ?? ""),
        );
        const firstIdx = texts.findIndex((t) => t.includes("First message"));
        const secondIdx = texts.findIndex((t) => t.includes("Second message"));
        expect(firstIdx).toBeGreaterThanOrEqual(0);
        expect(secondIdx).toBeGreaterThan(firstIdx);
    });

    test("CD-E-2: opening task drawer after session switches to task-chat-view", async ({ page, api, task }) => {
        const session = makeChatSession({ id: 441 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openSessionDrawer(page, session.id);
        await expect(page.locator(".session-chat-view")).toBeVisible();

        // Click task card — should replace session content with task content
        await page.locator(`[data-task-id="${task.id}"]`).click();

        await expect(page.locator(".task-chat-view")).toBeVisible({ timeout: 5_000 });
        await expect(page.locator(".session-chat-view")).not.toBeVisible();
    });

    test("CD-E-3: session drawer width persists across reloads via localStorage", async ({ page, api }) => {
        const session = makeChatSession({ id: 442 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.addInitScript(() => localStorage.setItem("railyn.drawerWidth", "600"));
        await page.goto("/");

        await openSessionDrawer(page, session.id);

        // Use evaluate to get the panel's actual rendered width (PrimeVue 4 positions classes on mask,
        // so we measure the inner panel .p-drawer element directly)
        const panelWidth = await page.evaluate(() => {
            const panel = document.querySelector(".p-drawer");
            return panel ? panel.getBoundingClientRect().width : 0;
        });
        // Width should be approximately 600px (allow ±20 for borders/padding)
        expect(panelWidth).toBeGreaterThanOrEqual(580);
        expect(panelWidth).toBeLessThanOrEqual(620);
    });

    test("CD-E-4: opening a session scrolls to the latest message", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 443 });
        const history = Array.from({ length: 240 }, (_, index) => ({
            id: `m${index + 1}`,
            role: index % 2 === 0 ? "user" : "assistant",
            content: `Message ${index + 1} — ${"detail ".repeat(24)}`,
        }));
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        agui.registerHistory(String(session.conversationId), history);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const chat = sessionChat(page);
        await expect(chat).toContainText("Message 240", { timeout: 10_000 });

        // CopilotChat scroll container (replaces the legacy .conv-body). The
        // autoscroll pinning runs after layout/nextTick — poll until pinned
        // instead of a single-shot evaluate (WR-05, the E-1/E-7 pattern).
        await expect
            .poll(() => page
                .locator('.session-chat-view [data-testid="copilot-chat-view-scroll"]')
                .evaluate((el) => {
                    const node = el as HTMLElement;
                    return node.scrollTop + node.clientHeight >= node.scrollHeight - 40;
                }))
            .toBe(true);
    });
});

// ─── Suite CD-F — Drawer lifecycle ────────────────────────────────────────────

test.describe("CD-F — Drawer lifecycle", () => {
    test("CD-F-1: clicking outside the drawer panel closes it", async ({ page, api }) => {
        const session = makeChatSession({ id: 450, title: "Outside Click Test" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);
        await expect(page.locator(".session-chat-view")).toBeVisible();

        // Click on the board header — which is outside the drawer panel
        await page.locator(".board-header").click({ position: { x: 100, y: 20 } });

        await expect(page.locator(".session-chat-view")).not.toBeVisible({ timeout: 3_000 });
    });

    test("CD-F-2: loading spinner is visible while messages are loading", async ({ page, api }) => {
        const session = makeChatSession({ id: 451 });
        api.returns("chatSessions.list", [session]);
        // Delay the messages response so we can observe the spinner
        api.delayed("conversations.getMessages", { messages: [], hasMore: false }, 1_500);

        await page.goto("/");
        await openSidebar(page);

        // Click the session but don't wait for drawer to be fully ready
        await page.locator(`[data-session-id="${session.id}"]`).click();

        // Spinner should appear while messages are loading
        await expect(page.locator(".scv-loading")).toBeVisible({ timeout: 2_000 });

        // After load completes, spinner should disappear
        await expect(page.locator(".scv-loading")).not.toBeVisible({ timeout: 5_000 });
    });

    test("CD-F-3: closing drawer removes is-active class from session items", async ({ page, api }) => {
        const session = makeChatSession({ id: 452 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Session should be highlighted as active
        await expect(page.locator(`[data-session-id="${session.id}"]`)).toHaveClass(/is-active/);

        // Close the drawer via the close button
        await page.locator(".session-chat-view button[aria-label='Close']").click();

        await expect(page.locator(".session-chat-view")).not.toBeVisible({ timeout: 3_000 });
        // No session item should have is-active anymore
        await expect(page.locator(".session-item.is-active")).toHaveCount(0);
    });
});

// ─── Suite CD-H — Boot sequence regression ────────────────────────────────────

test.describe("CD-H — Boot sequence regression", () => {
    test("CD-H-1: sessions appear in sidebar after page load without any WS push", async ({ page, api }) => {
        const s1 = makeChatSession({ id: 470, title: "Boot Session 1" });
        const s2 = makeChatSession({ id: 471, title: "Boot Session 2" });
        api.returns("chatSessions.list", [s1, s2]);

        // Navigate — NO WS events will be pushed
        await page.goto("/");
        await openSidebar(page);

        // Sessions should appear from chatSessions.list called at boot
        await expect(page.locator(".session-item")).toHaveCount(2, { timeout: 3_000 });
        await expect(page.locator(".session-item__title").first()).toContainText("Boot Session");
    });
});

// ─── Suite CD-I — Edge cases ──────────────────────────────────────────────────

test.describe("CD-I — Edge cases", () => {
    test("CD-I-1: saving a blank rename input does not call chatSessions.rename", async ({ page, api }) => {
        const session = makeChatSession({ id: 480, title: "Keep This Title" });
        api.returns("chatSessions.list", [session]);

        const renameCalls = api.capture("chatSessions.rename", undefined);

        await page.goto("/");
        await openSidebar(page);

        // Trigger rename mode via the pencil button
        await page.locator(`[data-session-id="${session.id}"]`).hover();
        await page.locator(`[data-session-id="${session.id}"] .session-item__action-btn`).first().click();

        const input = page.locator(".session-item__rename-input");
        await expect(input).toBeVisible({ timeout: 2_000 });

        // Clear the input and press Enter
        await input.fill("");
        await input.press("Enter");

        // Bound the negative window — a (buggy) late rename call must have
        // time to arrive before asserting absence (WR-04).
        await page.waitForTimeout(500);
        expect(renameCalls).toHaveLength(0);

        // Original title should still be displayed
        await expect(page.locator(`[data-session-id="${session.id}"] .session-item__title`)).toHaveText("Keep This Title");
    });

    test("CD-I-2: duplicate WS chatSession.updated events do not create duplicate sidebar items", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 481, title: "Single Session" });
        api.returns("chatSessions.list", [session]);

        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".session-item")).toHaveCount(1);

        // Push the same session update twice
        ws.pushChatSessionUpdated({ ...session, title: "Updated Title" });
        ws.pushChatSessionUpdated({ ...session, title: "Updated Title" });

        await page.waitForTimeout(300);

        // Still only one session item
        await expect(page.locator(".session-item")).toHaveCount(1);
        await expect(page.locator(".session-item__title").first()).toHaveText("Updated Title");
    });

    test("CD-I-3: opening a different session while one is open replaces the drawer content", async ({ page, api }) => {
        const sessionA = makeChatSession({ id: 482, title: "Session A" });
        const sessionB = makeChatSession({ id: 483, title: "Session B" });
        api.returns("chatSessions.list", [sessionA, sessionB]);
        api.handle("chatSessions.get", ({ sessionId }) => sessionId === sessionA.id ? sessionA : sessionB);
        api.handle("conversations.getMessages", ({ conversationId }) => ({
            messages: [],
            hasMore: false,
        }));

        await page.goto("/");
        await openSessionDrawer(page, sessionA.id);

        // Session A is open in drawer
        await expect(page.locator(".scv-header__title")).toContainText("Session A");

        // Click Session B while Session A is open — sidebar item may be behind drawer mask,
        // dispatch directly to bypass z-index interception
        await page.locator(`[data-session-id="${sessionB.id}"]`).dispatchEvent("click");

        // Drawer should now show session B
        await expect(page.locator(".scv-header__title")).toContainText("Session B", { timeout: 5_000 });
    });
});

test.describe("CD-J — action execution", () => {
    test("CD-J-1: clicking stop aborts the session run via /stop", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 490 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        agui.script = "slow";

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await submitChatMessageSession(page, "start something long");

        const stopBtn = page.locator('.session-chat-view [data-testid="stop-btn"]');
        await expect(stopBtn).toBeVisible({ timeout: 5_000 });
        await stopBtn.click();

        // The /stop round-trip hit the fixture for this thread (the legacy
        // chatSessions.cancel flow is replaced by the AG-UI abort path).
        await expect(page.locator('.session-chat-view [data-testid="chat-stopped"]')).toBeVisible({ timeout: 10_000 });
        expect(agui.stopRequests).toContain(String(session.conversationId));
    });

    test("CD-J-2: clicking archive calls chatSessions.archive and closes the drawer", async ({ page, api }) => {
        const session = makeChatSession({ id: 491, title: "Archive Me" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        const archiveCalls = api.capture("chatSessions.archive", undefined);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await page.locator(".scv-header__archive-btn").click();

        expect(archiveCalls).toEqual([{ sessionId: session.id }]);
        await expect(page.locator(".session-chat-view")).not.toBeVisible({ timeout: 3_000 });
    });
});

// ─── Suite CD-L — Tool-call rendering regression guard ────────────────────────
//
// The original bug was first observed in a chat session ("brokers").
// The legacy ConversationBody dropped orphaned tool_call children; the
// CopilotKit surface renders every tool call through its slot renderers, so
// this guards session-scoped tool rendering end-to-end.

test.describe("CD-L — Tool calls in session render as tool cards", () => {
    test("CD-L-1: session tool calls render the domain tool cards", async ({ page, api, agui }) => {
        const session = makeChatSession({ id: 498 });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        agui.script = "toolcall"; // shell/delegate/write family tool calls

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await submitChatMessageSession(page, "run the tools");

        const bashCard = page.locator('.session-chat-view [data-testid="tool-card-tc-bash"]');
        await expect(bashCard).toBeVisible({ timeout: 10_000 });
        await expect(bashCard).toContainText("ls -la");
    });
});
