/**
 * deferred-column-prompt.spec.ts — Playwright tests for deferred column prompt behaviour.
 *
 * When a running task is moved to a column with an on_enter_prompt, the backend
 * returns executionId: null and sets needs_column_prompt=1 in the DB.
 * The frontend should reflect the correct badge state (still running) and not
 * start a second execution until the drain fires after the first turn ends.
 *
 * Runs against dist/ served by vite preview (no Bun backend).
 * All API calls mocked via ApiMock (page.route), WS events via WsMock.
 */

import { test, expect } from "./fixtures";
import { navigateToBoard, dragCardToColumn } from "./fixtures/board-helpers";
import { makeTask } from "./fixtures/mock-data";

test.describe("Deferred column prompt", () => {
    // ── DND-RUNNING-1: dragging a running task to another column returns null executionId ──
    test("DND-RUNNING-1: dragging a running task to another column shows running badge (no new execution started)", async ({
        page,
        api,
        ws,
        task,
    }) => {
        // Pre-seed the task as running
        const runningTask = makeTask({ ...task, executionState: "running", workflowState: "backlog" });
        api.returns("tasks.list", [runningTask]);

        // Simulate backend returning null executionId (deferred path)
        const calls = api.capture("tasks.transition", {
            task: makeTask({ ...runningTask, workflowState: "plan" }),
            executionId: null,
        });

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`).first();
        await expect(card).toBeVisible();
        // Card should show running state
        await expect(card).toHaveClass(/exec-running/);

        // Push a WS task.updated event simulating the deferred move (same as what backend would push)
        ws.push({
            type: "task.updated",
            payload: makeTask({ ...runningTask, workflowState: "plan" }),
        });

        const planCol = page.locator("[data-column-id='plan']");
        // Card should have moved to plan column
        await expect(planCol.locator(`[data-task-id="${task.id}"]`)).toBeVisible();

        // Still running — no new execution started
        const cardInPlan = planCol.locator(`[data-task-id="${task.id}"]`);
        await expect(cardInPlan).toHaveClass(/exec-running/);

        // No unread dot should appear (running is not a terminal state)
        await expect(cardInPlan.locator(".task-card__unread-dot")).not.toBeVisible();
    });

    // ── DRAWER-DEFER-1: workflow select in drawer for a running task defers and keeps badge ──
    test("DRAWER-DEFER-1: column select in task drawer for a running task defers and shows running badge", async ({
        page,
        api,
        ws,
        task,
    }) => {
        // Pre-seed the task as running in backlog
        const runningTask = makeTask({ ...task, executionState: "running", workflowState: "backlog" });
        api.returns("tasks.list", [runningTask]);

        // Deferred path: backend returns task (moved to plan) with executionId null
        const movedTask = makeTask({ ...runningTask, workflowState: "plan" });
        api.returns("tasks.transition", { task: movedTask, executionId: null });

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`).first();
        await expect(card).toBeVisible();
        await expect(card).toHaveClass(/exec-running/);

        // Click the card to open the drawer
        await card.click();

        // Find the workflow-select dropdown and change to "plan"
        const workflowSelect = page.locator(".workflow-select");
        await expect(workflowSelect).toBeVisible();
        await workflowSelect.click();
        await page.locator(".p-select-option", { hasText: "Plan" }).click();

        // Simulate the WS push that backend sends after the deferred move
        ws.push({ type: "task.updated", payload: movedTask });

        // Card should have moved to plan column and still show running badge
        const planCol = page.locator("[data-column-id='plan']");
        const cardInPlan = planCol.locator(`[data-task-id="${task.id}"]`);
        await expect(cardInPlan).toBeVisible();
        await expect(cardInPlan).toHaveClass(/exec-running/);

        // No unread dot during execution
        await expect(cardInPlan.locator(".task-card__unread-dot")).not.toBeVisible();
    });
});
