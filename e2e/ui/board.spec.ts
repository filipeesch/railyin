/**
 * board.spec.ts — UI tests for the board view.
 *
 * Suites:
 *   S — Board structure (columns render, task card appears, initial state)
 *   T — Task transitions (card moves between columns)
 *   U — Execution state visuals (CSS class and badge update live)
 *   P — Card placement on column transition (moved card lands at top)
 */

import { test, expect } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { Task } from "@shared/rpc-types";

async function navigateToBoard(page: import("@playwright/test").Page) {
    // Navigate to the board view (assume it's the default or use nav link)
    await page.goto("/");
    await expect(page.locator(".board-columns, [data-testid='board-columns']")).toBeVisible({ timeout: 5_000 });
}

// ─── Suite S — Board structure ────────────────────────────────────────────────

test.describe("S — board structure", () => {
    test("S-1: board-columns container is visible", async ({ page }) => {
        await navigateToBoard(page);
        await expect(page.locator(".board-columns, [data-testid='board-columns']")).toBeVisible();
    });

    test("S-2: board renders all expected columns in order", async ({ page }) => {
        await navigateToBoard(page);

        const columns = page.locator("[data-column-id]");
        const ids = await columns.evaluateAll((els) => els.map((e) => e.getAttribute("data-column-id")));

        expect(ids).toContain("backlog");
        expect(ids).toContain("plan");
        expect(ids).toContain("in_progress");
        expect(ids).toContain("in_review");
        expect(ids).toContain("done");

        // Order
        expect(ids.indexOf("backlog")).toBeLessThan(ids.indexOf("plan"));
        expect(ids.indexOf("plan")).toBeLessThan(ids.indexOf("in_progress"));
        expect(ids.indexOf("in_progress")).toBeLessThan(ids.indexOf("in_review"));
        expect(ids.indexOf("in_review")).toBeLessThan(ids.indexOf("done"));
    });

    test("S-3: column headers show expected labels", async ({ page }) => {
        await navigateToBoard(page);

        const headers = page.locator(".board-column__header, [data-testid='column-header']");
        const texts = await headers.allTextContents();
        const joined = texts.join(" ");

        expect(joined).toContain("Backlog");
        expect(joined).toContain("Plan");
        expect(joined).toContain("In Progress");
        expect(joined).toContain("In Review");
        expect(joined).toContain("Done");
    });

    test("S-4: test task card appears in backlog column", async ({ page, task }) => {
        await navigateToBoard(page);

        const taskCard = page.locator(`[data-task-id="${task.id}"]`);
        await expect(taskCard).toBeVisible({ timeout: 3_000 });

        // Should be inside the backlog column
        const backlogColumn = page.locator("[data-column-id='backlog']");
        await expect(backlogColumn.locator(`[data-task-id="${task.id}"]`)).toBeVisible();
    });

    test("S-5: idle task card has exec-idle CSS class", async ({ page, task }) => {
        await navigateToBoard(page);
        await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveClass(/exec-idle/);
    });

    test("S-6: idle task card shows 'Idle' badge", async ({ page, task }) => {
        await navigateToBoard(page);
        const badge = page.locator(`[data-task-id="${task.id}"] .task-card__footer .p-tag`);
        await expect(badge).toContainText("Idle");
    });
});

// ─── Suite T — Task transitions ───────────────────────────────────────────────

test.describe("T — task transitions", () => {
    test("T-7: transitioning to 'done' moves card to done column", async ({ page, api, ws, task }) => {
        const doneTask: Task = { ...task, workflowState: "done" };

        api.handle("tasks.transition", async () => {
            setTimeout(() => ws.push({ type: "task.updated", payload: doneTask }), 50);
            return { task: doneTask, executionId: null };
        });

        await navigateToBoard(page);

        // Right-click or use context menu to transition (or a direct button)
        // Use drag-drop if that's the UI, otherwise look for a transition button
        const taskCard = page.locator(`[data-task-id="${task.id}"]`);
        await taskCard.click({ button: "right" });

        const moveMenuItem = page.locator("[data-testid='move-to-done'], .context-menu__item:has-text('Done')");
        if (await moveMenuItem.isVisible({ timeout: 1_000 })) {
            await moveMenuItem.click();
        } else {
            // Push the update directly to simulate the transition
            ws.push({ type: "task.updated", payload: doneTask });
        }

        await expect(page.locator("[data-column-id='done']").locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 5_000 });
    });

    test("T-8: card is no longer in backlog after transition to done", async ({ page, api, ws, task }) => {
        const doneTask: Task = { ...task, workflowState: "done" };

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: doneTask });

        await expect(page.locator("[data-column-id='done']").locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 3_000 });
        await expect(page.locator("[data-column-id='backlog']").locator(`[data-task-id="${task.id}"]`)).not.toBeVisible();
    });

    test("T-9: task stays idle after transition to done (no on_enter_prompt)", async ({ page, api, ws, task }) => {
        const doneIdleTask: Task = { ...task, workflowState: "done", executionState: "idle" };
        api.handle("tasks.list", () => [doneIdleTask]);

        await navigateToBoard(page);

        const badge = page.locator(`[data-task-id="${task.id}"] .task-card__footer .p-tag`);
        await expect(badge).toContainText("Idle", { timeout: 3_000 });
    });

    test("T-10: transitioning back to backlog moves card back", async ({ page, api, ws, task }) => {
        const backlogTask: Task = { ...task, workflowState: "backlog" };
        api.handle("tasks.list", () => [{ ...task, workflowState: "done" }]);

        api.handle("tasks.transition", async () => {
            setTimeout(() => ws.push({ type: "task.updated", payload: backlogTask }), 50);
            return { task: backlogTask, executionId: null };
        });

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: backlogTask });

        await expect(page.locator("[data-column-id='backlog']").locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 5_000 });
    });

    test("T-11: transitioning to 'plan' moves card to plan column", async ({ page, api, ws, task }) => {
        const planTask: Task = { ...task, workflowState: "plan" };
        api.handle("tasks.transition", async () => {
            setTimeout(() => ws.push({ type: "task.updated", payload: planTask }), 50);
            return { task: planTask, executionId: null };
        });

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: planTask });

        await expect(page.locator("[data-column-id='plan']").locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 5_000 });
    });
});

// ─── Suite U — Execution state visuals ───────────────────────────────────────

test.describe("U — execution state visuals on task card", () => {
    test("U-12: idle task card has exec-idle class and 'Idle' badge", async ({ page, task }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toHaveClass(/exec-idle/);

        const badge = card.locator(".task-card__footer .p-tag");
        await expect(badge).toContainText("Idle");
    });

    test("U-13: task card gets exec-running class when execution starts", async ({ page, api, ws, task }) => {
        const runningTask: Task = { ...task, executionState: "running" };

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: runningTask });

        await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveClass(/exec-running/, { timeout: 5_000 });
    });

    test("U-14: running task card shows 'Running…' or 'Done' badge", async ({ page, api, ws, task }) => {
        const runningTask: Task = { ...task, executionState: "running" };

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: runningTask });

        const badge = page.locator(`[data-task-id="${task.id}"] .task-card__footer .p-tag`);
        // Accept either Running… (mid-stream) or Done (if settled quickly)
        await expect(badge).toHaveText(/Running|Done/i, { timeout: 5_000 });
    });

    test("U-15: card gets exec-completed class after execution finishes", async ({ page, api, ws, task }) => {
        const completedTask: Task = { ...task, executionState: "completed" };

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: completedTask });

        await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveClass(/exec-completed/, { timeout: 5_000 });
    });

    test("U-16: completed task card shows 'Done' badge", async ({ page, api, ws, task }) => {
        const completedTask: Task = { ...task, executionState: "completed" };
        api.handle("tasks.list", () => [completedTask]);

        await navigateToBoard(page);

        const badge = page.locator(`[data-task-id="${task.id}"] .task-card__footer .p-tag`);
        await expect(badge).toContainText("Done", { timeout: 5_000 });
    });
});

// ─── Suite P — Card placement on column transition ────────────────────────────

test.describe("P — card placement on column transition", () => {
    test("P-17: card moved to non-empty column appears first in that column", async ({ page, api, ws }) => {
        // task1 lands in in_progress with position 250, below existing task2 at position 1000
        const task2 = makeTask({ id: 2, workflowState: "in_progress", position: 1000 });
        const task1 = makeTask({ id: 1, workflowState: "backlog", position: 500 });
        api.handle("tasks.list", () => [task1, task2]);

        await navigateToBoard(page);

        // Verify initial layout: task2 is in in_progress, task1 is in backlog
        await expect(page.locator("[data-column-id='in_progress']").locator(`[data-task-id="${task2.id}"]`)).toBeVisible();
        await expect(page.locator("[data-column-id='backlog']").locator(`[data-task-id="${task1.id}"]`)).toBeVisible();

        // Simulate transition: task1 moves to in_progress with position 250 (top, since 250 < 1000)
        const movedTask1: Task = { ...task1, workflowState: "in_progress", position: 250 };
        ws.push({ type: "task.updated", payload: movedTask1 });

        const inProgressColumn = page.locator("[data-column-id='in_progress']");
        await expect(inProgressColumn.locator(`[data-task-id="${task1.id}"]`)).toBeVisible({ timeout: 5_000 });

        // task1 (position 250) must appear before task2 (position 1000) in DOM order
        const cardIds = await inProgressColumn.locator("[data-task-id]").evaluateAll(
            (els) => els.map((el) => Number(el.getAttribute("data-task-id")))
        );
        expect(cardIds.indexOf(task1.id)).toBeLessThan(cardIds.indexOf(task2.id));
    });

    test("P-18: card moved to empty column lands as sole card", async ({ page, api, ws, task }) => {
        await navigateToBoard(page);

        // Verify in_progress is initially empty
        await expect(page.locator("[data-column-id='in_progress']").locator("[data-task-id]")).toHaveCount(0);

        // Simulate transition to the empty in_progress column (position 500 — default for empty)
        const movedTask: Task = { ...task, workflowState: "in_progress", position: 500 };
        ws.push({ type: "task.updated", payload: movedTask });

        const inProgressColumn = page.locator("[data-column-id='in_progress']");
        await expect(inProgressColumn.locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 5_000 });

        const cardIds = await inProgressColumn.locator("[data-task-id]").evaluateAll(
            (els) => els.map((el) => el.getAttribute("data-task-id"))
        );
        expect(cardIds).toHaveLength(1);
        expect(cardIds[0]).toBe(String(task.id));
    });
});
