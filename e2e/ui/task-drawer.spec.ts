import { test, expect } from "./fixtures";

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
});
