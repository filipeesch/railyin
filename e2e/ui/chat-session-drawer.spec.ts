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
 *   CD-G — Model selector (populated from boot, selection works)
 *   CD-H — Boot sequence regression (sessions/models load without WS)
 *   CD-I — Edge cases (blank rename, WS dedup, replace open session)
 *
 * Backend is fully mocked via ApiMock + WsMock fixtures.
 */

import { test, expect, openSidebar, openSessionDrawer, typeInSessionEditor } from "./fixtures";
import { makeChatSession, makeChatMessage, WORKSPACE_KEY } from "./fixtures/mock-data";
import type { StreamEvent } from "@shared/rpc-types";
import type { ApiMock } from "./fixtures/mock-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_EXEC_ID = 2001;

function sessionTextChunk(conversationId: number, executionId: number, seq: number, content: string, done = false): StreamEvent {
    return {
        taskId: null,
        conversationId,
        executionId,
        seq,
        blockId: `${executionId}-text`,
        type: "text_chunk",
        content,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done,
    };
}

function stubSessionMessages(api: ApiMock, conversationId: number, messages: ReturnType<typeof makeChatMessage>[]) {
    api.handle("conversations.getMessages", ({ conversationId: requestedConversationId }) => ({
        messages: requestedConversationId === conversationId ? [...messages] : [],
        hasMore: false,
    }));
}

function sessionInterviewPrompt(conversationId: number, content: string): ReturnType<typeof makeChatMessage> {
    return makeChatMessage(0, conversationId, content, "assistant", {
        type: "interview_prompt",
        role: null,
    });
}

// ─── Suite CD-A — Opening and rendering ───────────────────────────────────────

test.describe("CD-A — Opening and rendering", () => {
    test("CD-A-1: clicking session in sidebar opens .session-chat-view", async ({ page, api }) => {
        const session = makeChatSession({ id: 400, title: "My Session" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".session-chat-view")).toBeVisible();
    });

    test("CD-A-2: session title appears in drawer header", async ({ page, api }) => {
        const session = makeChatSession({ id: 401, title: "Named Session" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".scv-header__title, .session-chat-view [data-testid='session-title']")).toContainText("Named Session");
    });

    test("CD-A-3: no tab switcher visible in session drawer (tabs are task-only)", async ({ page, api }) => {
        const session = makeChatSession({ id: 402 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // PrimeVue TabList should NOT be present in session mode
        await expect(page.locator(".session-chat-view .p-tablist, .session-chat-view [role='tablist']")).toHaveCount(0);
    });

    test("CD-A-4: prior messages render as bubbles", async ({ page, api }) => {
        const session = makeChatSession({ id: 403 });
        const userMsg = makeChatMessage(session.id, session.conversationId, "Hello!");
        const aiMsg = makeChatMessage(session.id, session.conversationId, "Hi there!", "assistant");
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, [userMsg, aiMsg]);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".session-chat-view .msg--user")).toHaveCount(1);
        await expect(page.locator(".session-chat-view .msg--assistant")).toHaveCount(1);
    });

    test("CD-A-5: archive button is visible in drawer header", async ({ page, api }) => {
        const session = makeChatSession({ id: 404 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".scv-header__archive-btn, .session-chat-view [data-action='archive']")).toBeVisible();
    });

    test("CD-A-6: model selector is present in the input area", async ({ page, api }) => {
        const session = makeChatSession({ id: 405 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Model selector should be present (shared feature via ConversationInput)
        await expect(page.locator(".session-chat-view .input-model-select, .session-chat-view .model-empty-state")).toBeVisible();
    });
});

// ─── Suite CD-B — Sending messages ────────────────────────────────────────────

test.describe("CD-B — Sending messages", () => {
    test("CD-B-1: typing and pressing Enter adds user bubble", async ({ page, api }) => {
        const session = makeChatSession({ id: 410 });
        const userMsg = makeChatMessage(session.id, session.conversationId, "Test message");
        const messages: ReturnType<typeof makeChatMessage>[] = [];

        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, messages);
        api.handle("chatSessions.sendMessage", () => {
            messages.push(userMsg);
            return { executionId: -1, message: userMsg };
        });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const before = await page.locator(".session-chat-view .msg--user").count();
        await typeInSessionEditor(page, "Test message");

        await expect(page.locator(".session-chat-view .msg--user")).toHaveCount(before + 1, { timeout: 3_000 });
    });

    test("CD-B-2: Shift+Enter inserts newline rather than sending", async ({ page, api }) => {
        const session = makeChatSession({ id: 411 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        let sendCalled = false;
        api.handle("chatSessions.sendMessage", () => { sendCalled = true; return { executionId: -1, message: null }; });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await typeInSessionEditor(page, "Line 1", "Shift+Enter");

        await page.waitForTimeout(300);
        expect(sendCalled).toBe(false);
    });

    test("CD-B-3: send button is disabled when editor is empty", async ({ page, api }) => {
        const session = makeChatSession({ id: 412 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const sendBtn = page.locator(".session-chat-view [data-testid='send-btn']");
        await expect(sendBtn).toBeDisabled();
    });

    test("CD-B-4: send calls chatSessions.sendMessage API endpoint", async ({ page, api }) => {
        const session = makeChatSession({ id: 413 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        let sendPayload: unknown = null;
        const userMsg = makeChatMessage(session.id, session.conversationId, "API check");
        api.handle("chatSessions.sendMessage", (body) => {
            sendPayload = body;
            return { executionId: -1, message: userMsg };
        });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await typeInSessionEditor(page, "API check");

        await page.waitForTimeout(300);
        expect(sendPayload).not.toBeNull();
    });

    test("CD-B-5: can send a second message after the assistant turn completes without reopening the drawer", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 414, status: "idle" });
        const messages: ReturnType<typeof makeChatMessage>[] = [];
        let sendCount = 0;

        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, messages);
        api.handle("chatSessions.sendMessage", (body) => {
            sendCount += 1;
            const content = String((body as { content?: unknown }).content ?? "");
            messages.push(makeChatMessage(session.id, session.conversationId, content, "user"));

            setTimeout(() => {
                const executionId = SESSION_EXEC_ID + sendCount;
                ws.pushChatSessionUpdated({ ...session, status: "running" });
                ws.pushStreamEvent(sessionTextChunk(session.conversationId, executionId, sendCount, `Reply ${sendCount}`));
                messages.push(makeChatMessage(session.id, session.conversationId, `Reply ${sendCount}`, "assistant"));
                ws.pushStreamEvent({
                    taskId: null,
                    conversationId: session.conversationId,
                    executionId,
                    seq: 900 + sendCount,
                    blockId: `${executionId}-done`,
                    type: "done",
                    content: "",
                    metadata: null,
                    parentBlockId: null,
                    subagentId: null,
                    done: true,
                });
                ws.pushChatSessionUpdated({ ...session, status: "idle" });
            }, 20);

            return {
                executionId: SESSION_EXEC_ID + sendCount,
                message: makeChatMessage(session.id, session.conversationId, content, "user"),
            };
        });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await typeInSessionEditor(page, "First message");
        await expect(page.locator(".session-chat-view .scv-status-tag[data-status='idle']")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".session-chat-view [data-testid='send-btn']")).toBeVisible({ timeout: 3_000 });

        await typeInSessionEditor(page, "Second message");

        await expect.poll(() => sendCount).toBe(2);
        await expect(page.locator(".session-chat-view .msg--user")).toHaveCount(2, { timeout: 3_000 });
    });

    test("CD-B-6: sending a session message does not blank the drawer into loading state", async ({ page, api }) => {
        const session = makeChatSession({ id: 415, status: "idle" });
        const existingAssistant = makeChatMessage(session.id, session.conversationId, "Existing reply", "assistant");
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, [existingAssistant]);
        api.handle("chatSessions.sendMessage", (body) => {
            const content = String((body as { content?: unknown }).content ?? "");
            return {
                executionId: SESSION_EXEC_ID,
                message: makeChatMessage(session.id, session.conversationId, content, "user"),
            };
        });

        await page.goto("/");
        await openSessionDrawer(page, session.id);
        await expect(page.locator(".session-chat-view .msg--assistant")).toContainText("Existing reply");

        await typeInSessionEditor(page, "No blink");

        await expect(page.locator(".session-chat-view .scv-loading")).toHaveCount(0);
        await expect(page.locator(".session-chat-view .msg--assistant")).toContainText("Existing reply");
        await expect(page.locator(".session-chat-view .msg--user")).toContainText("No blink");
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

    test("CD-C-2: status badge returns to idle after done event", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 421, status: "running" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        ws.pushStreamEvent({
            taskId: null,
            conversationId: session.conversationId,
            executionId: SESSION_EXEC_ID,
            seq: 999,
            blockId: `${SESSION_EXEC_ID}-done`,
            type: "done",
            content: "",
            metadata: null,
            parentBlockId: null,
            subagentId: null,
            done: true,
        });

        await expect(page.locator(".session-chat-view .scv-status-tag[data-status='idle']")).toBeVisible({ timeout: 2_000 });
        await expect(page.locator(".session-chat-view [data-testid='send-btn']")).toBeVisible({ timeout: 2_000 });
    });

    test("CD-C-3: send button disabled while session status is running", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 422, status: "idle" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        ws.pushChatSessionUpdated({ ...session, status: "running" });

        // When running, the send button is replaced by a cancel button
        await expect(page.locator(".session-chat-view [data-testid='cancel-btn']")).toBeVisible({ timeout: 2_000 });
        await expect(page.locator(".session-chat-view [data-testid='send-btn']")).not.toBeAttached({ timeout: 2_000 });
    });

    test("CD-C-4: cancel button appears while session is running", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 423, status: "idle" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        ws.pushChatSessionUpdated({ ...session, status: "running" });

        await expect(page.locator(".session-chat-view [data-testid='cancel-btn']")).toBeVisible({ timeout: 2_000 });
    });

    test("CD-C-5: live stream chunks render in the session conversation body", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 424, status: "idle" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        ws.pushChatSessionUpdated({ ...session, status: "running" });
        ws.pushStreamEvent(sessionTextChunk(session.conversationId, SESSION_EXEC_ID, 0, "Streaming session text"));

        await expect(page.locator(".session-chat-view .msg__bubble.streaming")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".session-chat-view .msg__bubble.streaming")).toContainText("Streaming session text");
    });

    test("CD-C-5b: persisted history stays ahead of the live session tail in one ordered list", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 4241, status: "idle" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, [
            makeChatMessage(session.id, session.conversationId, "Persisted session answer", "assistant", { id: 92_000 }),
        ]);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        ws.pushChatSessionUpdated({ ...session, status: "running" });
        ws.pushStreamEvent(sessionTextChunk(session.conversationId, SESSION_EXEC_ID + 1, 0, "Live session tail"));

        await expect(page.locator(".session-chat-view .conv-body__tail")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".session-chat-view .msg__bubble.streaming")).toContainText("Live session tail");

        const order = await page.locator(".session-chat-view .conv-body [data-index]").evaluateAll((nodes) =>
            nodes.map((node) => {
                const tail = node.querySelector(".conv-body__tail");
                if (tail) return `tail:${tail.textContent?.trim() ?? ""}`;
                const bubble = node.querySelector(".msg__bubble");
                return `msg:${bubble?.textContent?.trim() ?? ""}`;
            }),
        );

        expect(order).toHaveLength(2);
        expect(order[0]).toContain("Persisted session answer");
        expect(order[1]).toContain("Live session tail");
    });

    test("CD-C-6: only one loading indicator is shown while waiting on session status updates", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 425, status: "running" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        ws.pushStreamEvent({
            taskId: null,
            conversationId: session.conversationId,
            executionId: SESSION_EXEC_ID,
            seq: 1,
            blockId: `${SESSION_EXEC_ID}-status`,
            type: "status_chunk",
            content: "Thinking…",
            metadata: null,
            parentBlockId: null,
            subagentId: null,
            done: false,
        });

        await expect(page.locator(".session-chat-view .conv-body__system")).toHaveCount(1);
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

    test("CD-D-3: send is enabled in waiting_user state (user can respond)", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 432, status: "waiting_user" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await typeInSessionEditor(page, "my response", "Shift+Enter");

        const sendBtn = page.locator(".session-chat-view [data-testid='send-btn']");
        await expect(sendBtn).not.toBeDisabled();
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

        await page.waitForTimeout(300);
        expect(renameCalled).toBe(true);
    });

    test("CD-D-6: interview prompt submit sends the answer through chatSessions.sendMessage", async ({ page, api }) => {
        const session = makeChatSession({ id: 435, status: "waiting_user" });
        const prompt = sessionInterviewPrompt(session.conversationId, JSON.stringify({
            questions: [
                {
                    question: "Which option?",
                    type: "exclusive",
                    options: [
                        { title: "Keep current flow", description: "Stay with the current behavior." },
                        { title: "Use unified flow", description: "Use the shared session/task behavior." },
                    ],
                },
            ],
        }));
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, [prompt]);

        let sentBody: Record<string, unknown> | null = null;
        api.handle("chatSessions.sendMessage", (body) => {
            sentBody = body as Record<string, unknown>;
            return {
                executionId: SESSION_EXEC_ID,
                message: makeChatMessage(session.id, session.conversationId, String(sentBody.content ?? ""), "user"),
            };
        });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await page.locator(".session-chat-view .interview__option-title", { hasText: "Use unified flow" }).click();
        await page.locator(".session-chat-view .interview__submit").click();

        await expect.poll(() => sentBody?.content).toContain("Use unified flow");
    });
});

// ─── Suite CD-E — Persistence and ordering ────────────────────────────────────

test.describe("CD-E — Persistence and ordering", () => {
    test("CD-E-1: messages render in chronological order (oldest first)", async ({ page, api }) => {
        const session = makeChatSession({ id: 440 });
        const msg1 = makeChatMessage(session.id, session.conversationId, "First message", "user");
        const msg2 = makeChatMessage(session.id, session.conversationId, "Second message", "assistant");
        msg1.createdAt = "2024-01-01T00:00:00.000Z";
        msg2.createdAt = "2024-01-01T00:01:00.000Z";
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, [msg1, msg2]);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const bubbles = page.locator(".session-chat-view .msg__bubble");
        await expect(bubbles).toHaveCount(2);
        await expect(bubbles.first()).toContainText("First message");
        await expect(bubbles.last()).toContainText("Second message");
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

    test("CD-E-4: opening a session scrolls to the latest message", async ({ page, api }) => {
        const session = makeChatSession({ id: 443 });
        const messages = Array.from({ length: 240 }, (_, index) =>
            makeChatMessage(
                session.id,
                session.conversationId,
                `Message ${index + 1} — ${"detail ".repeat(24)}`,
                index % 2 === 0 ? "user" : "assistant",
            ),
        );
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, messages);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await expect(page.locator(".session-chat-view .msg__bubble").last()).toContainText("Message 240");
        const isAtBottom = await page.locator(".session-chat-view .conv-body").evaluate((el) => {
            const node = el as HTMLElement;
            return node.scrollTop + node.clientHeight >= node.scrollHeight - 40;
        });
        expect(isAtBottom).toBe(true);
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

// ─── Suite CD-G — Model selector ──────────────────────────────────────────────

test.describe("CD-G — Model selector", () => {
    test("CD-G-1: model dropdown shows options populated from boot", async ({ page, api }) => {
        const session = makeChatSession({ id: 460 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        // models.listEnabled is already stubbed in the base fixture

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Model select should be visible (models loaded at boot, not empty-state)
        await expect(page.locator(".session-chat-view .input-model-select")).toBeVisible();

        // Open the dropdown to verify options are present
        await page.locator(".session-chat-view .input-model-select").click();
        await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });
        await expect(page.locator(".p-select-overlay .p-select-option")).toHaveCount(1, { timeout: 2_000 });

        // Close the dropdown
        await page.keyboard.press("Escape");
    });

    test("CD-G-2: selecting a model from the dropdown updates the displayed selection", async ({ page, api }) => {
        const session = makeChatSession({ id: 461 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        await page.locator(".session-chat-view .input-model-select").click();
        await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });

        // Click the first option
        const option = page.locator(".p-select-overlay .p-select-option").first();
        const optionTitle = await option.locator(".model-select__option-title").innerText();
        await option.click();

        // The model select value label should now show the selected model
        await expect(page.locator(".session-chat-view .model-select__value")).toContainText(optionTitle.trim());
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

    test("CD-H-2: model dropdown is populated after page load without any manual trigger", async ({ page, api }) => {
        const session = makeChatSession({ id: 472 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        // models.listEnabled stub returns one model (set in base fixture)

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Model select (not empty-state) should be present — models loaded at boot
        await expect(page.locator(".session-chat-view .input-model-select")).toBeVisible();
        await expect(page.locator(".session-chat-view .model-empty-state")).toHaveCount(0);
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

        await page.waitForTimeout(300);
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
    test("CD-J-1: clicking cancel calls chatSessions.cancel and can transition to waiting_user", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 490, status: "idle" });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        const cancelCalls = api.capture("chatSessions.cancel", undefined);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        ws.pushChatSessionUpdated({ ...session, status: "running" });
        const cancelBtn = page.locator(".session-chat-view [data-testid='cancel-btn']");
        await expect(cancelBtn).toBeVisible({ timeout: 2_000 });
        await cancelBtn.click();

        expect(cancelCalls).toEqual([{ sessionId: session.id }]);

        ws.pushChatSessionUpdated({ ...session, status: "waiting_user" });
        await expect(page.locator(".session-chat-view .scv-status-tag[data-status='waiting_user']")).toBeVisible({ timeout: 2_000 });
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

// ─── Suite CD-K — File chip attachments ──────────────────────────────────────

test.describe("CD-K — file chip attachments", () => {
    test("CD-K-1: sending a #file chip in session chat includes @file attachment in chatSessions.sendMessage", async ({ page, api }) => {
        const session = makeChatSession({ id: 495 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        api.returns("workspace.listFiles", [{ name: "utils.ts", path: "src/utils.ts" }]);
        api.returns("lsp.workspaceSymbol", []);

        let capturedAttachments: unknown[] | undefined;
        api.handle("chatSessions.sendMessage", (params: { attachments?: unknown[] }) => {
            capturedAttachments = params.attachments;
            return { executionId: -1, message: makeChatMessage(session.id, session.conversationId, "#utils.ts") };
        });

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const editor = page.locator(".session-chat-view .chat-editor .cm-content");
        await editor.click();
        await page.keyboard.type("#utils");

        await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 1_000 });
        await page.keyboard.press("Enter"); // select file chip

        const sendResponsePromise = page.waitForResponse("**/api/chatSessions.sendMessage");
        await page.locator(".session-chat-view [data-testid='send-btn']").click();
        await sendResponsePromise;

        expect(capturedAttachments).toBeDefined();
        expect(capturedAttachments!.length).toBeGreaterThan(0);
        const att = capturedAttachments![0] as { data: string; label: string; mediaType: string };
        expect(att.data).toBe("@file:src/utils.ts");
        expect(att.label).toBe("utils.ts");
        expect(att.mediaType).toBe("text/plain");
    });

    test("CD-K-2: #file chip renders as styled token in session chat editor", async ({ page, api }) => {
        const session = makeChatSession({ id: 496 });
        api.returns("chatSessions.list", [session]);
        stubSessionMessages(api, session.conversationId, []);
        api.returns("workspace.listFiles", [{ name: "index.ts", path: "src/index.ts" }]);
        api.returns("lsp.workspaceSymbol", []);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        const editor = page.locator(".session-chat-view .chat-editor .cm-content");
        await editor.click();
        await page.keyboard.type("#index");

        await expect(page.locator(".cm-tooltip-autocomplete [aria-selected]")).toBeVisible({ timeout: 3_000 });
        await page.keyboard.press("Enter");

        // Chip must render as a styled widget, not raw markup text
        await expect(page.locator(".session-chat-view .chat-editor .chat-editor__chip")).toBeVisible({ timeout: 2_000 });
        const rawText = await page.locator(".session-chat-view .chat-editor .cm-content").textContent();
        expect(rawText).not.toContain("[#");
    });
});
