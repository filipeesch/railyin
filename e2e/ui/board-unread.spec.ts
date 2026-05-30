import { test, expect } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";
import { makeBoard, makeTask } from "./fixtures/mock-data";

test.describe("Board unread indicators", () => {
    test("UNREAD-1: task card shows unread dot after task.updated WS push with terminal executionState", async ({
        page,
        task,
        ws,
    }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toBeVisible();

        // Unread is triggered by task.updated with a terminal execution state (completed/waiting_user/failed/cancelled)
        ws.push({
            type: "task.updated",
            payload: makeTask({ id: task.id, executionState: "completed" }),
        });

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

    test("UNREAD-3: workspace tab shows unread dot when a background task reaches terminal execution state", async ({
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
        // Board 1 (BOARD_ID) belongs to ws-2 — that's where the task lives for unread tracking.
        // Board 2 belongs to test-workspace (the active workspace) so navigateToBoard can select it.
        api.returns("boards.list", [
            makeBoard({ id: 2, workspaceKey: "test-workspace" }),
            makeBoard({ workspaceKey: "ws-2" }),
        ]);

        await navigateToBoard(page);

        // Both workspace tabs should be visible
        const ws1Tab = page.locator(".workspace-tab", { hasText: "Test Workspace" });
        const ws2Tab = page.locator(".workspace-tab", { hasText: "Workspace 2" });
        await expect(ws1Tab).toBeVisible();
        await expect(ws2Tab).toBeVisible();

        // No unread dots initially
        await expect(ws2Tab.locator(".workspace-tab__unread-dot")).not.toBeVisible();

        // Push task.updated with completed state for the task on board 1 (owned by ws-2)
        ws.push({
            type: "task.updated",
            payload: makeTask({ id: task.id, executionState: "completed" }),
        });

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

        // Trigger unread state via terminal execution state
        ws.push({
            type: "task.updated",
            payload: makeTask({ id: task.id, executionState: "completed" }),
        });
        await expect(card.locator(".task-card__unread-dot")).toBeVisible();

        // Click the card — calls taskStore.selectTask(taskId) which clears unread
        await card.click();

        // Unread dot should be gone
        await expect(card.locator(".task-card__unread-dot")).not.toBeVisible();
    });

    test("UNREAD-5: task.updated with 'waiting_user' executionState triggers unread dot", async ({
        page,
        task,
        ws,
    }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toBeVisible();

        ws.push({
            type: "task.updated",
            payload: makeTask({ id: task.id, executionState: "waiting_user" }),
        });

        await expect(card.locator(".task-card__unread-dot")).toBeVisible();
    });

    test("UNREAD-6: task.updated with 'running' executionState does NOT trigger unread dot", async ({
        page,
        task,
        ws,
    }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toBeVisible();

        ws.push({
            type: "task.updated",
            payload: makeTask({ id: task.id, executionState: "running" }),
        });

        // No unread dot during an active execution
        await expect(card.locator(".task-card__unread-dot")).not.toBeVisible();
    });

    test("UNREAD-7: task.updated with only workflowState change does NOT trigger unread dot", async ({
        page,
        task,
        ws,
    }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toBeVisible();

        // Move the task to a different column (workflow state change, no execution state change)
        ws.push({
            type: "task.updated",
            payload: makeTask({ id: task.id, executionState: "idle", workflowState: "plan" }),
        });

        await expect(card.locator(".task-card__unread-dot")).not.toBeVisible();
    });
});
