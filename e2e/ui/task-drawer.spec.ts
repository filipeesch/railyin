import { test, expect, openTaskDrawer, sendMessage } from "./fixtures";
import { makeAssistantMessage, makeTransitionMessage, makeTask } from "./fixtures/mock-data";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    test("TD-2: shared toolbar shows model, context, MCP, and attachment controls in task mode", async ({ page, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".task-chat-view .input-model-select")).toBeVisible();
        await expect(page.locator(".task-chat-view .context-ring-btn")).toBeVisible();
        await expect(page.locator(".task-chat-view .conv-input__mcp-btn")).toBeVisible();
        await expect(page.locator(".task-chat-view button:has(.pi-paperclip)")).toBeVisible();
    });

    test("TD-3: selecting a file adds an attachment chip before send", async ({ page, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".task-chat-view input[type='file']").setInputFiles(path.resolve(__dirname, "../../README.md"));

        await expect(page.locator(".task-chat-view .attachment-chip")).toHaveCount(1);
        await expect(page.locator(".task-chat-view .attachment-chip")).toContainText("README.md");
    });

    test("TD-4: header close button closes the task drawer", async ({ page, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".task-chat-view .tcv-header__actions button[severity='secondary'], .task-chat-view .tcv-header__actions button:has(.pi-times)").last().click();

        await expect(page.locator(".task-detail")).not.toBeVisible({ timeout: 3_000 });
    });

    test("TD-5: opening a task chat starts at the latest message", async ({ page, api, task }) => {
        const messages = Array.from({ length: 240 }, (_, index) => ({
            id: 70_000 + index,
            taskId: task.id,
            conversationId: task.conversationId,
            type: index % 2 === 0 ? "user" : "assistant",
            role: index % 2 === 0 ? "user" : "assistant",
            content: `Task message ${index + 1} — ${"detail ".repeat(24)}`,
            metadata: null,
            createdAt: new Date(Date.now() + index * 1_000).toISOString(),
        }));
        api.handle("conversations.getMessages", () => ({ messages: messages, hasMore: false }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".task-chat-view .msg__bubble").last()).toContainText("Task message 240");
        const isAtBottom = await page.locator(".task-chat-view .conv-body").evaluate((el) => {
            const node = el as HTMLElement;
            return node.scrollTop + node.clientHeight >= node.scrollHeight - 40;
        });
        expect(isAtBottom).toBe(true);
    });

    test("TD-6: persisted history and live stream tail share one ordered conversation list", async ({ page, api, ws, task }) => {
        api.handle("conversations.getMessages", () => ({
            messages: [
                makeAssistantMessage(task.id, "Persisted assistant answer", {
                    id: 81_000,
                    conversationId: task.conversationId,
                }),
            ],
            hasMore: false,
        }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent({
            taskId: task.id,
            conversationId: task.conversationId,
            executionId: 81_001,
            seq: 0,
            blockId: "81_001-text",
            type: "text_chunk",
            content: "Live tail answer",
            metadata: null,
            parentBlockId: null,
            subagentId: null,
            done: false,
        });

        await expect(page.locator(".task-chat-view .conv-body__tail")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".task-chat-view .msg__bubble.streaming")).toContainText("Live tail answer");

        const order = await page.locator(".task-chat-view .conv-body [data-index]").evaluateAll((nodes) =>
            nodes.map((node) => {
                const tail = node.querySelector(".conv-body__tail");
                if (tail) return `tail:${tail.textContent?.trim() ?? ""}`;
                const bubble = node.querySelector(".msg__bubble");
                return `msg:${bubble?.textContent?.trim() ?? ""}`;
            }),
        );

        expect(order).toHaveLength(2);
        expect(order[0]).toContain("Persisted assistant answer");
        expect(order[1]).toContain("Live tail answer");
    });

    test("TD-7: transition cards keep instructions collapsed by default and expand with chip styling", async ({ page, api, task }) => {
        api.handle("conversations.getMessages", () => ({
            messages: [
                makeTransitionMessage(task.id, {
                    from: "Backlog",
                    to: "Plan",
                    instructionDetail: {
                        displayText: "Expanded instructions for transition card",
                        sourceText: "Run [/opsx:apply|/opsx:apply] with [#src/app.ts|#app.ts] via [@chrome-devtools:click|@click]",
                        sourceKind: "slash",
                    },
                }, {
                    id: 83_000,
                    conversationId: task.conversationId,
                }),
            ],
            hasMore: false,
        }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const card = page.locator(".transition-card");
        await expect(card).toContainText("Moved to Plan from Backlog");
        await expect(card).toContainText("To");
        await expect(card).toContainText("From");
        await expect(card.locator(".transition-card__details-body")).not.toBeVisible();

        await card.locator(".transition-card__details-summary").click();

        await expect(card.locator(".transition-card__details-body")).toBeVisible();
        await expect(card.locator(".inline-chip-text__chip--slash")).toContainText("/opsx:apply");
        await expect(card.locator(".inline-chip-text__chip--file")).toContainText("#app.ts");
        await expect(card.locator(".inline-chip-text__chip--tool")).toContainText("@click");
        await expect(card.locator(".transition-card__details-body")).not.toContainText("Expanded instructions for transition card");
        await expect(card).not.toContainText("Source");
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

test.describe("MSG — user message appears immediately", () => {
    test("MSG-1: user message appears in chat without reopening drawer (conversationId=0→real)", async ({
        page,
        api,
    }) => {
        // Task starts with conversationId=0 (DB has NULL conversation_id).
        const task = makeTask({ id: 7, conversationId: 0 });
        api.handle("tasks.list", () => [task]);
        api.returns("conversations.getMessages", { messages: [], hasMore: false });

        // Backend creates a real conversation (id=99) when the first message is sent.
        api.handle("tasks.sendMessage", () => ({
            executionId: 1,
            message: {
                id: 5001,
                taskId: task.id,
                conversationId: 99, // new real conversation — differs from task.conversationId (0)
                type: "user" as const,
                role: "user" as const,
                content: "hello world",
                metadata: null,
                createdAt: new Date().toISOString(),
            },
        }));

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Send a message through the UI.
        await sendMessage(page, "hello world");

        // The user message must appear inside the open drawer — no reopen needed.
        await expect(page.locator(".task-detail .conv-body .msg--user")).toBeVisible({ timeout: 5_000 });
        await expect(page.locator(".task-detail .conv-body .msg--user")).toContainText("hello world");
    });
});
