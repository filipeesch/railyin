/**
 * board-allowed-transitions.spec.ts — Tests for column allowedTransitions enforcement.
 *
 * Uses a workflow template where `backlog` has allowedTransitions: ["plan"].
 * This means dragging from backlog → plan is allowed; all other destinations are forbidden.
 */

import { test, expect } from "./fixtures";
import { makeTask, makeWorkflowTemplate, setupBoardWithTemplate } from "./fixtures/mock-data";
import { navigateToBoard, startDragOnCard } from "./fixtures/board-helpers";

// Template: backlog only allows transitions to "plan"
const restrictedTemplate = {
    ...makeWorkflowTemplate(),
    columns: [
        { id: "backlog", label: "Backlog", allowedTransitions: ["plan"] },
        { id: "plan", label: "Plan" },
        { id: "in_progress", label: "In Progress" },
        { id: "in_review", label: "In Review" },
        { id: "done", label: "Done" },
    ],
} as ReturnType<typeof makeWorkflowTemplate>;

test.describe("AT — allowed transitions", () => {
    // ── AT-1: forbidden columns get .is-drag-forbidden during drag ─────────────
    test("AT-1: forbidden destination columns get .is-drag-forbidden class on drag-start", async ({
        page,
        api,
    }) => {
        setupBoardWithTemplate(api, restrictedTemplate);
        const task = makeTask({ id: 1, workflowState: "backlog", position: 0 });
        api.handle("tasks.list", () => [task]);

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`).first();
        await startDragOnCard(page, card);

        // All columns except "plan" are forbidden destinations
        for (const colId of ["in_progress", "in_review", "done"]) {
            await expect(page.locator(`[data-column-id='${colId}']`)).toHaveClass(
                /is-drag-forbidden/,
                { timeout: 2_000 },
            );
        }

        await page.mouse.up();
    });

    // ── AT-2: cursor is not-allowed over a forbidden column ─────────────────────
    test("AT-2: cursor is 'not-allowed' when hovering over a forbidden column", async ({
        page,
        api,
    }) => {
        setupBoardWithTemplate(api, restrictedTemplate);
        const task = makeTask({ id: 2, workflowState: "backlog", position: 0 });
        api.handle("tasks.list", () => [task]);

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`).first();
        await startDragOnCard(page, card);

        // Move over a forbidden column
        const forbiddenCol = page.locator("[data-column-id='done']");
        const colBox = await forbiddenCol.boundingBox();
        if (!colBox) throw new Error("done column has no bounding box");
        await page.mouse.move(
            colBox.x + colBox.width / 2,
            colBox.y + colBox.height / 2,
            { steps: 5 },
        );

        await expect(forbiddenCol).toHaveClass(/is-drag-forbidden/, { timeout: 2_000 });

        const cursor = await forbiddenCol.evaluate(
            (el) => getComputedStyle(el).cursor,
        );
        expect(cursor).toBe("not-allowed");

        await page.mouse.up();
    });

    // ── AT-3: dropping on forbidden column fires no tasks.transition call ───────
    test("AT-3: dropping on a forbidden column does not call tasks.transition", async ({
        page,
        api,
    }) => {
        setupBoardWithTemplate(api, restrictedTemplate);
        const task = makeTask({ id: 3, workflowState: "backlog", position: 0 });
        api.handle("tasks.list", () => [task]);

        // Capture any tasks.transition calls
        const calls = api.capture("tasks.transition", {
            task: makeTask({ ...task, workflowState: "done" }),
            executionId: null,
        });

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`).first();
        await startDragOnCard(page, card);

        // Drop on a forbidden column
        const forbiddenCol = page.locator("[data-column-id='done']");
        const colBox = await forbiddenCol.boundingBox();
        if (!colBox) throw new Error("done column has no bounding box");
        await page.mouse.move(
            colBox.x + colBox.width / 2,
            colBox.y + colBox.height / 2,
            { steps: 5 },
        );
        await page.mouse.up();

        // Wait a moment and assert no API call was made
        await page.waitForTimeout(200);
        expect(calls.length).toBe(0);
    });

    // ── AT-4: allowed column does NOT get .is-drag-forbidden ────────────────────
    test("AT-4: the allowed destination column does not get .is-drag-forbidden class", async ({
        page,
        api,
    }) => {
        setupBoardWithTemplate(api, restrictedTemplate);
        const task = makeTask({ id: 4, workflowState: "backlog", position: 0 });
        api.handle("tasks.list", () => [task]);

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`).first();
        await startDragOnCard(page, card);

        // "plan" is the only allowed transition from backlog
        await expect(page.locator("[data-column-id='plan']")).not.toHaveClass(
            /is-drag-forbidden/,
            { timeout: 2_000 },
        );

        await page.mouse.up();
    });
});
