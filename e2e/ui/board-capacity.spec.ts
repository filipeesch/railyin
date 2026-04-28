/**
 * board-capacity.spec.ts — WIP limit / column capacity visual and behavioural tests.
 *
 * Tests run against dist/ (vite preview). No real backend.
 */

import { test, expect } from "./fixtures";
import { navigateToBoard, startDragOnCard, dragCardToColumn } from "./fixtures/board-helpers";
import { makeTask, makeWorkflowTemplate, setupBoardWithTemplate, BOARD_ID } from "./fixtures/mock-data";

// Shared template: in_progress has limit: 2
const capacityTemplate = {
    ...makeWorkflowTemplate(),
    columns: [
        { id: "backlog", label: "Backlog" },
        { id: "plan", label: "Plan" },
        { id: "in_progress", label: "In Progress", limit: 2 },
        { id: "in_review", label: "In Review" },
        { id: "done", label: "Done" },
    ],
} as any;

// ─── Suite CAP — Column capacity ─────────────────────────────────────────────

test.describe("CAP — column capacity", () => {
    test("CAP-1: column at capacity shows .is-drag-over--full when dragged over", async ({
        page,
        api,
    }) => {
        setupBoardWithTemplate(api, capacityTemplate);

        const task1 = makeTask({ id: 10, workflowState: "in_progress", position: 0 });
        const task2 = makeTask({ id: 11, workflowState: "in_progress", position: 1 });
        const task3 = makeTask({ id: 12, workflowState: "backlog", position: 0 });
        api.handle("tasks.list", () => [task1, task2, task3]);

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task3.id}"]`);
        const column = page.locator("[data-column-id='in_progress']");

        await startDragOnCard(page, card);
        const colBox = await column.boundingBox();
        if (!colBox) throw new Error("in_progress column has no bounding box");
        await page.mouse.move(
            colBox.x + colBox.width / 2,
            colBox.y + colBox.height / 2,
            { steps: 10 },
        );

        await expect(column).toHaveClass(/is-drag-over--full/, { timeout: 2_000 });
        // The plain is-drag-over class (without --full) should NOT be present
        const classAttr = await column.getAttribute("class") ?? "";
        const classes = classAttr.split(/\s+/);
        expect(classes).not.toContain("is-drag-over");

        await page.mouse.up();
    });

    test("CAP-2: badge shows danger severity when column is at capacity", async ({
        page,
        api,
    }) => {
        setupBoardWithTemplate(api, capacityTemplate);

        const task1 = makeTask({ id: 20, workflowState: "in_progress", position: 0 });
        const task2 = makeTask({ id: 21, workflowState: "in_progress", position: 1 });
        api.handle("tasks.list", () => [task1, task2]);

        await navigateToBoard(page);

        const badge = page.locator("[data-column-id='in_progress'] .board-column__header .p-badge");
        await expect(badge).toBeVisible({ timeout: 3_000 });

        // PrimeVue v4 badge with severity="danger" adds data-p-severity or a class containing "danger"
        const hasDanger =
            (await badge.getAttribute("data-p-severity")) === "danger" ||
            (await badge.evaluate((el) => el.className.includes("danger")));
        expect(hasDanger).toBe(true);
    });

    test("CAP-3: badge shows secondary severity when column is below capacity", async ({
        page,
        api,
    }) => {
        setupBoardWithTemplate(api, capacityTemplate);

        const task1 = makeTask({ id: 30, workflowState: "in_progress", position: 0 });
        api.handle("tasks.list", () => [task1]);

        await navigateToBoard(page);

        const badge = page.locator("[data-column-id='in_progress'] .board-column__header .p-badge");
        await expect(badge).toBeVisible({ timeout: 3_000 });

        const isNotDanger =
            (await badge.getAttribute("data-p-severity")) !== "danger" &&
            !(await badge.evaluate((el) => el.className.includes("danger")));
        expect(isNotDanger).toBe(true);
    });

    test("CAP-4: column exactly at limit blocks drag-over visual", async ({
        page,
        api,
    }) => {
        setupBoardWithTemplate(api, capacityTemplate);

        const task1 = makeTask({ id: 40, workflowState: "in_progress", position: 0 });
        const task2 = makeTask({ id: 41, workflowState: "in_progress", position: 1 });
        const task3 = makeTask({ id: 42, workflowState: "backlog", position: 0 });
        api.handle("tasks.list", () => [task1, task2, task3]);

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task3.id}"]`);
        const column = page.locator("[data-column-id='in_progress']");

        await startDragOnCard(page, card);
        const colBox = await column.boundingBox();
        if (!colBox) throw new Error("in_progress column has no bounding box");
        await page.mouse.move(
            colBox.x + colBox.width / 2,
            colBox.y + colBox.height / 2,
            { steps: 10 },
        );

        await expect(column).toHaveClass(/is-drag-over--full/, { timeout: 2_000 });

        await page.mouse.up();
    });

    test("CAP-5: column below capacity accepts drop and calls tasks.transition", async ({
        page,
        api,
    }) => {
        setupBoardWithTemplate(api, capacityTemplate);

        const task1 = makeTask({ id: 50, workflowState: "in_progress", position: 0 });
        const task2 = makeTask({ id: 51, workflowState: "backlog", position: 0 });
        api.handle("tasks.list", () => [task1, task2]);

        // Provide a valid reorderColumn stub to avoid 501 noise
        api.returns("tasks.reorderColumn", undefined);

        const transitionCalls = api.capture("tasks.transition", {
            task: makeTask({ id: 51, workflowState: "in_progress" }),
            executionId: null,
        });

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task2.id}"]`);
        const column = page.locator("[data-column-id='in_progress']");

        await dragCardToColumn(page, card, column);

        // tasks.transition is called fire-and-forget — wait briefly for it
        await page.waitForTimeout(300);

        expect(transitionCalls.length).toBeGreaterThan(0);
    });
});
