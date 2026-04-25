import { test, expect } from "./fixtures";
import { makeAssistantMessage } from "./fixtures/mock-data";

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

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

        await page.locator(".task-chat-view input[type='file']").setInputFiles("/Users/filipe.esch/projects/worktrees/task/126-chat-session-2nd-round/README.md");

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
        api.handle("conversations.getMessages", () => messages);

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
        api.handle("conversations.getMessages", () => [
            makeAssistantMessage(task.id, "Persisted assistant answer", {
                id: 81_000,
                conversationId: task.conversationId,
            }),
        ]);

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
