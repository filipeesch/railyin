import { test, expect, openTaskDrawer, submitChatMessage } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";

/**
 * task-drawer.spec.ts — task drawer coverage.
 *
 * Migrated onto the agui fixture (Phase 6, plan 06-06):
 *   MSG-1 → S-1 (submitChatMessage streams via /run — user message appears
 *          in the open drawer, no reopen)
 *   TD-5/6 → S-2 + registerHistory (latest message visible; persisted
 *          history + live stream tail share one ordered conversation list)
 * TD-1/4/8 stay byte-identical (green board-surface chrome tests) and the
 * TD-B launch-button suite is untouched.
 *
 * Retired in-file (TD-2 toolbar chrome, TD-3 attachment chip, TD-7
 * transition cards — removed surfaces; see the retire block at the bottom).
 */

test.describe("TD — task drawer coverage", () => {
    test("TD-1: task drawer opens on Chat tab and can switch to Info and back", async ({ page, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".task-chat-view .tab-btn--active")).toContainText("Chat");
        await page.locator(".task-chat-view .tab-btn:has-text('Info')").click();
        await expect(page.locator(".task-chat-view .tab-btn--active")).toContainText("Info");
        await page.locator(".task-chat-view .tab-btn:has-text('Chat')").click();
        await expect(page.locator(".task-chat-view .tab-btn--active")).toContainText("Chat");
    });

    test("TD-4: header close button closes the task drawer", async ({ page, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".task-chat-view .tcv-header__actions button[severity='secondary'], .task-chat-view .tcv-header__actions button:has(.pi-times)").last().click();

        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });
    });

    test("TD-5: opening a task chat starts at the latest message", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4205, conversationId: 4205, title: "TD-5 Task" });
        api.handle("tasks.list", () => [t]);
        // Ordered multi-message history replay (registerHistory knob): the
        // connect MESSAGES_SNAPSHOT carries the alternating history verbatim,
        // order preserved.
        agui.registerHistory(String(t.conversationId), [
            { id: "u1", role: "user", content: "Task message 1" },
            { id: "a1", role: "assistant", content: "Task message 2" },
            { id: "u2", role: "user", content: "Task message 3" },
            { id: "a2", role: "assistant", content: "Task message 4" },
            { id: "u3", role: "user", content: "Task message 5" },
            { id: "a3", role: "assistant", content: "Task message 6 — latest" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);

        // The latest (last) message renders on open — the replay starts the
        // conversation at the tail.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("Task message 6 — latest", { timeout: 10_000 });

        // Full ordered list: alternating user/assistant history, latest last.
        const userMsgs = chat.locator('[data-testid="copilot-user-message"]');
        const assistantMsgs = chat.locator('[data-testid="copilot-assistant-message"]');
        await expect(userMsgs).toHaveCount(3, { timeout: 10_000 });
        await expect(assistantMsgs).toHaveCount(3);
        await expect(assistantMsgs.nth(0)).toContainText("Task message 2");
        await expect(assistantMsgs.nth(2)).toContainText("Task message 6 — latest");
    });

    test("TD-6: persisted history and live stream tail share one ordered conversation list", async ({ page, api, agui }) => {
        const t = makeTask({ id: 4206, conversationId: 4206, title: "TD-6 Task" });
        api.handle("tasks.list", () => [t]);
        agui.registerHistory(String(t.conversationId), [
            { id: "u1", role: "user", content: "Persisted user question" },
            { id: "a1", role: "assistant", content: "Persisted assistant answer" },
        ]);

        await page.goto("/");
        await openTaskDrawer(page, t.id);
        await page.locator('[data-testid="chat-input"] textarea').waitFor({ state: "visible", timeout: 10_000 });

        // Live stream tail: the /run streams the new user turn + the quick
        // assistant text on top of the replayed history.
        await submitChatMessage(page, "Live tail answer");

        const chat = page.locator('[data-testid="copilot-chat-view"]');
        const userMsgs = chat.locator('[data-testid="copilot-user-message"]');
        const assistantMsgs = chat.locator('[data-testid="copilot-assistant-message"]');

        // Persisted history first, live tail last — ONE ordered list.
        await expect(userMsgs).toHaveCount(2, { timeout: 10_000 });
        await expect(userMsgs.nth(0)).toContainText("Persisted user question");
        await expect(userMsgs.nth(1)).toContainText("Live tail answer");
        await expect(assistantMsgs.nth(0)).toContainText("Persisted assistant answer");
        await expect(assistantMsgs.nth(1)).toContainText("hello", { timeout: 10_000 });
    });

    test("TD-8: drawer shows Git tab button and switching to it renders .task-tab-git", async ({ page, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".task-chat-view .tab-btn:has-text('Git')")).toBeVisible();
        await page.locator(".task-chat-view .tab-btn:has-text('Git')").click();
        await expect(page.locator(".task-chat-view .tab-btn--active")).toContainText("Git");
        await expect(page.locator(".task-chat-view .task-tab-git")).toBeVisible();
    });
});

// ─── Suite TD-B — Launch buttons ─────────────────────────────────────────────

test.describe("TD-B — launch buttons", () => {
    test("TD-B-1: SplitButton dropdown doesn't close drawer when menu item clicked", async ({ page, api, task }) => {
        // Mock launch config to return multiple tools (to trigger SplitButton rendering)
        // SplitButton only appears when a section has > 1 entries
        api.returns("launch.getConfig", {
            profiles: [],
            tools: [
                { label: "Build", icon: "pi-cog", command: "npm run build" },
                { label: "Test", icon: "pi-check", command: "npm test" },
            ],
        });
        // Use the fixture task but override worktreeStatus and worktreePath for launch buttons to appear
        api.handle("tasks.list", () => [{ ...task, worktreeStatus: "ready", worktreePath: "/tmp/test" }]);

        await page.goto("/");

        // Wait for the board to load tasks
        await page.locator(`[data-task-id="${task.id}"]`).waitFor({ state: "visible", timeout: 10_000 });

        await openTaskDrawer(page, task.id);

        // Wait for launch buttons to appear (split button with multiple entries)
        await expect(page.locator(".launch-splitbtn")).toBeVisible({ timeout: 10_000 });

        // Click launch button dropdown (the split button has multiple entries)
        await page.locator(".launch-splitbtn .p-splitbutton-dropdown").click();

        // Verify menu is visible (PrimeVue v4 SplitButton uses TieredMenu, class is p-tieredmenu)
        await expect(page.locator(".p-tieredmenu")).toBeVisible({ timeout: 3_000 });

        // Click menu item
        await page.locator(".p-tieredmenu .p-tieredmenu-item", { hasText: "Test" }).click();

        // Verify drawer is still open (menu click shouldn't close it)
        await expect(page.locator(".task-detail")).toBeVisible();
    });
});

// ─── Suite MSG — Message send / conversation-id sync ──────────────────────────
//
// Bug: when a task has conversationId=0 (null in DB), the first message sent
// via tasks.sendMessage creates a real conversation on the backend (e.g. id=99).
// The returned message has conversationId=99, but the store's activeConversationId
// is still 0, so appendMessage silently drops the message.  The user doesn't see
// their own message until they close and reopen the drawer (which reloads from API).
//
// Fix: after tasks.sendMessage returns, if message.conversationId ≠ activeConversationId,
// call conversationStore.setActiveConversation(message.conversationId) before appendMessage.
//
// Migrated (plan 06-06): on the CopilotKit surface the user turn renders from
// the /run stream in the OPEN drawer — the same "no reopen needed" guarantee.

test.describe("MSG — user message appears immediately", () => {
    test("MSG-1: user message appears in chat without reopening drawer (conversationId=0→real)", async ({
        page,
        api,
    }) => {
        // Task starts with conversationId=0 (DB has NULL conversation_id).
        const task = makeTask({ id: 7, conversationId: 0 });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Send a message through the UI.
        await submitChatMessage(page, "hello world");

        // The user message must appear inside the open drawer — no reopen needed.
        const chat = page.locator('[data-testid="copilot-chat-view"]');
        await expect(chat).toContainText("hello world", { timeout: 10_000 });
    });
});

// ─── Retired tests (in-file rationale, plan 06-06) ───────────────────────────
//
// TD-2 — shared toolbar shows model, context, MCP, and attachment controls:
//        the toolbar chrome is removed with the legacy input (.input-model-select
//        only existed in the dead ConversationInput.vue:175; the context ring
//        + MCP popover + paperclip attachment controls are trimmed features).
// TD-3 — selecting a file adds an attachment chip before send: attachment
//        chips removed (attachments out of scope CONT-01).
// TD-7 — transition cards keep instructions collapsed: transition_event
//        conversation rendering removed (FEATURES.md trim list).
