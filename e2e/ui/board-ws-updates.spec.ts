import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";
import { makeTask } from "./fixtures/mock-data";

test.describe("Board WebSocket updates", () => {
    test("WS-1: task.updated WS push updates card execution state badge (running → completed)", async ({
        page,
        task,
        ws,
    }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toBeVisible();
        await expect(card).toHaveClass(/exec-idle/);

        ws.push({ type: "task.updated", payload: { ...task, executionState: "running" } });

        await expect(card).toHaveClass(/exec-running/);
    });

    test("WS-2: task.updated WS push moves card to new column when workflowState changes", async ({
        page,
        task,
        ws,
    }) => {
        await navigateToBoard(page);

        const backlogColumn = page.locator("[data-column-id='backlog']");
        await expect(backlogColumn.locator(`[data-task-id="${task.id}"]`)).toBeVisible();

        ws.push({ type: "task.updated", payload: { ...task, workflowState: "plan" } });

        const planColumn = page.locator("[data-column-id='plan']");
        await expect(planColumn.locator(`[data-task-id="${task.id}"]`)).toBeVisible();
        await expect(backlogColumn.locator(`[data-task-id="${task.id}"]`)).not.toBeVisible();
    });

    test("WS-3: AI-created task appears on board via task.updated WS push", async ({
        page,
        task: _task,
        ws,
    }) => {
        await navigateToBoard(page);

        const newTask = makeTask({ id: 999, title: "AI-created task", workflowState: "backlog" });

        // Backend now broadcasts task.updated when AI creates a task via execCreateTask.
        // Frontend _replaceTask inserts the task when it is not already in the board list.
        ws.push({ type: "task.updated", payload: newTask });

        await expect(page.locator(`[data-task-id="${newTask.id}"]`)).toBeVisible();
    });

    test("WS-4: task.updated push for unknown task is ignored gracefully (no crash)", async ({
        page,
        task,
        ws,
    }) => {
        await navigateToBoard(page);

        const unknownTask = makeTask({ id: 9999, title: "Ghost task", workflowState: "backlog" });
        ws.push({ type: "task.updated", payload: unknownTask });

        // Board should still render correctly and the default task card should be visible
        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toBeVisible();
    });
});

test.describe("Board WebSocket updates — worktree buttons", () => {
    test("WS-WT-1: task.updated with null worktreePath hides Terminal button in open drawer", async ({
        page,
        api,
        ws,
    }) => {
        const taskWithWorktree = makeTask({ id: 50, worktreePath: "/wt/1", worktreeStatus: "ready" });
        api.handle("tasks.list", () => [taskWithWorktree]);

        await page.goto("/");
        await openTaskDrawer(page, taskWithWorktree.id);

        // Verify terminal button is initially visible
        await expect(page.locator(".tcv-toolbar button:has(.pi-desktop)")).toBeVisible({ timeout: 3_000 });

        // Push task.updated with null worktreePath (simulates pre-fix bug when backend omitted git context join)
        ws.push({ type: "task.updated", payload: { ...taskWithWorktree, worktreePath: null, worktreeStatus: null } });

        // Terminal button should now be hidden
        await expect(page.locator(".tcv-toolbar button:has(.pi-desktop)")).not.toBeAttached();
    });

    test("WS-WT-2: task.updated preserving worktreePath keeps Terminal button visible in open drawer", async ({
        page,
        api,
        ws,
    }) => {
        const taskWithWorktree = makeTask({ id: 51, worktreePath: "/wt/1", worktreeStatus: "ready" });
        api.handle("tasks.list", () => [taskWithWorktree]);

        await page.goto("/");
        await openTaskDrawer(page, taskWithWorktree.id);

        // Verify terminal button is initially visible
        await expect(page.locator(".tcv-toolbar button:has(.pi-desktop)")).toBeVisible({ timeout: 3_000 });

        // Push task.updated with worktreePath preserved (correct post-fix behavior)
        ws.push({ type: "task.updated", payload: { ...taskWithWorktree, executionState: "running" } });

        // Terminal button should remain visible
        await expect(page.locator(".tcv-toolbar button:has(.pi-desktop)")).toBeVisible();
    });
});
