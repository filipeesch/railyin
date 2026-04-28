import { test, expect } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";
import { makeAssistantMessage, makeBoard } from "./fixtures/mock-data";

test.describe("Board unread indicators", () => {
    test("UNREAD-1: task card shows unread dot after message.new WS push for that task", async ({
        page,
        task,
        ws,
    }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toBeVisible();

        // Must be an assistant message — onTaskNewMessage only marks unread
        // for assistant/reasoning/system/file_diff types, not user messages.
        ws.push({ type: "message.new", payload: makeAssistantMessage(task.id, "hello") });

        await expect(card.locator(".task-card__unread-dot")).toBeVisible();
    });

    test("UNREAD-2: task card unread dot is absent on initial load with no new messages", async ({
        page,
        task,
    }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toBeVisible();

        await expect(card.locator(".task-card__unread-dot")).not.toBeVisible();
    });

    test("UNREAD-3: workspace tab shows unread dot when a task in that workspace receives message.new", async ({
        page,
        task,
        ws,
        api,
    }) => {
        // Two workspace tabs: the active one is "test-workspace", the second is "ws-2".
        // Board 1 belongs to "ws-2" so that the task loaded for board 1 counts as ws-2 unread.
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);
        api.returns("boards.list", [makeBoard({ workspaceKey: "ws-2" })]);

        await navigateToBoard(page);

        // Both workspace tabs should be visible
        const ws1Tab = page.locator(".workspace-tab", { hasText: "Test Workspace" });
        const ws2Tab = page.locator(".workspace-tab", { hasText: "Workspace 2" });
        await expect(ws1Tab).toBeVisible();
        await expect(ws2Tab).toBeVisible();

        // No unread dots initially
        await expect(ws2Tab.locator(".workspace-tab__unread-dot")).not.toBeVisible();

        // Push an assistant message for the task that lives on board 1 (owned by ws-2)
        ws.push({ type: "message.new", payload: makeAssistantMessage(task.id, "New activity in ws-2") });

        // Workspace 2 tab should now show the unread dot
        await expect(ws2Tab.locator(".workspace-tab__unread-dot")).toBeVisible();

        // Active workspace tab ("test-workspace") should NOT show the unread dot
        await expect(ws1Tab.locator(".workspace-tab__unread-dot")).not.toBeVisible();
    });

    test("UNREAD-4: unread dot disappears after user opens the task (clicks the card)", async ({
        page,
        task,
        ws,
    }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toBeVisible();

        // Trigger unread state
        ws.push({ type: "message.new", payload: makeAssistantMessage(task.id, "hello") });
        await expect(card.locator(".task-card__unread-dot")).toBeVisible();

        // Click the card — calls taskStore.selectTask(taskId) which clears unread
        await card.click();

        // Unread dot should be gone
        await expect(card.locator(".task-card__unread-dot")).not.toBeVisible();
    });
});
