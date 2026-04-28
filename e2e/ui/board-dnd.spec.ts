/**
 * board-dnd.spec.ts — Playwright tests for BoardView drag-and-drop.
 *
 * Runs against dist/ served by vite preview (no Bun backend).
 * All API calls mocked via ApiMock (page.route), WS events via WsMock.
 */

import { test, expect } from "./fixtures";
import { makeTask, makeWorkflowTemplate, setupBoardWithTemplate } from "./fixtures/mock-data";
import {
    navigateToBoard,
    startDragOnCard,
    dragCardToColumn,
    assertGhostInDom,
} from "./fixtures/board-helpers";

test.describe("DND — drag and drop", () => {
    // ── DND-1: drag activates after pointer moves >5px ──────────────────────
    test("DND-1: drag starts after pointer moves >5px — source card becomes invisible", async ({
        page,
        task,
    }) => {
        await navigateToBoard(page);
        // Use .first() because the ghost clone (appended to body) also carries data-task-id
        const card = page.locator(`[data-task-id="${task.id}"]`).first();
        await startDragOnCard(page, card);

        // BoardView.vue sets opacity:0 on the source element when drag activates
        const opacity = await card.evaluate((el: HTMLElement) => el.style.opacity);
        expect(opacity).toBe("0");

        await page.mouse.up();
    });

    // ── DND-2: ghost clone appears in document.body ──────────────────────────
    test("DND-2: ghost clone appears in document.body during drag", async ({ page, task }) => {
        await navigateToBoard(page);
        const card = page.locator(`[data-task-id="${task.id}"]`);
        await startDragOnCard(page, card);

        await assertGhostInDom(page);

        await page.mouse.up();
    });

    // ── DND-3: column gets .is-drag-over when card hovers ───────────────────
    test("DND-3: column gets .is-drag-over class when card hovers over it", async ({
        page,
        task,
    }) => {
        await navigateToBoard(page);
        const card = page.locator(`[data-task-id="${task.id}"]`);
        await startDragOnCard(page, card);

        // Move to the center of the plan column
        const planCol = page.locator("[data-column-id='plan']");
        const colBox = await planCol.boundingBox();
        if (!colBox) throw new Error("plan column has no bounding box");
        await page.mouse.move(
            colBox.x + colBox.width / 2,
            colBox.y + colBox.height / 2,
            { steps: 5 },
        );

        await expect(planCol).toHaveClass(/is-drag-over/);

        await page.mouse.up();
    });

    // ── DND-4: drop calls tasks.transition with correct workflowState ────────
    test("DND-4: drop on different column calls tasks.transition with correct workflowState", async ({
        page,
        api,
        task,
    }) => {
        const calls = api.capture("tasks.transition", {
            task: makeTask({ ...task, workflowState: "plan" }),
            executionId: null,
        });

        await navigateToBoard(page);
        const card = page.locator(`[data-task-id="${task.id}"]`);
        const planCol = page.locator("[data-column-id='plan']");

        await dragCardToColumn(page, card, planCol);

        // Wait briefly for the fire-and-forget API call
        await page.waitForTimeout(200);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ taskId: task.id, toState: "plan" });
    });

    // ── DND-5: drop on same column makes no tasks.transition call ────────────
    test("DND-5: drop on same column makes no tasks.transition call", async ({
        page,
        api,
        task,
    }) => {
        const calls = api.capture("tasks.transition", {
            task: makeTask({ ...task }),
            executionId: null,
        });

        await navigateToBoard(page);
        const card = page.locator(`[data-task-id="${task.id}"]`);
        // task is in backlog by default — drag back to backlog
        const backlogCol = page.locator("[data-column-id='backlog']");

        await dragCardToColumn(page, card, backlogCol);

        await page.waitForTimeout(200);

        expect(calls).toHaveLength(0);
    });

    // ── DND-6: column at capacity gets .is-drag-over--full ──────────────────
    test("DND-6: column at capacity gets .is-drag-over--full (not .is-drag-over) on hover", async ({
        page,
        api,
        task,
    }) => {
        // Build a template where in_progress has limit: 1
        const template = makeWorkflowTemplate();
        const inProgressCol = template.columns.find((c) => c.id === "in_progress")!;
        inProgressCol.limit = 1;

        // One task in in_progress (fills the column), task stays in backlog
        const blockerTask = makeTask({ workflowState: "in_progress" });
        api.handle("tasks.list", () => [task, blockerTask]);
        setupBoardWithTemplate(api, template);

        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await startDragOnCard(page, card);

        const inProgressColEl = page.locator("[data-column-id='in_progress']");
        const colBox = await inProgressColEl.boundingBox();
        if (!colBox) throw new Error("in_progress column has no bounding box");
        await page.mouse.move(
            colBox.x + colBox.width / 2,
            colBox.y + colBox.height / 2,
            { steps: 5 },
        );

        await expect(inProgressColEl).toHaveClass(/is-drag-over--full/);
        await expect(inProgressColEl).not.toHaveClass(/(?<![a-z])is-drag-over(?![a-z-])/);

        await page.mouse.up();
    });

    // ── DND-7: user-select is restored on pointerup ──────────────────────────
    test("DND-7: user-select style is restored on pointerup regardless of drag activation", async ({
        page,
        task,
    }) => {
        await navigateToBoard(page);
        const card = page.locator(`[data-task-id="${task.id}"]`);

        await startDragOnCard(page, card);
        await page.mouse.up();

        const bodyUserSelect = await page.evaluate(
            () => document.body.style.userSelect,
        );
        const htmlUserSelect = await page.evaluate(
            () => document.documentElement.style.userSelect,
        );

        expect(bodyUserSelect).toBe("");
        expect(htmlUserSelect).toBe("");
    });

    // ── DND-8: no optimistic update — card stays in original column on API failure ──
    test("DND-8: card stays in original column when tasks.transition fails (no optimistic update)", async ({
        page,
        api,
        task,
    }) => {
        // Mock tasks.transition to simulate a server error
        api.handle("tasks.transition", () => {
            throw new Error("server error");
        });

        await navigateToBoard(page);
        const card = page.locator(`[data-task-id="${task.id}"]`);
        const planCol = page.locator("[data-column-id='plan']");

        await dragCardToColumn(page, card, planCol);

        // Wait for fire-and-forget API call and any async error handling
        await page.waitForTimeout(500);

        // BoardView.vue has no optimistic update: the card was never moved in the store
        // (no WS push), so the card remains visible in backlog regardless of API failure.
        const backlogCol = page.locator("[data-column-id='backlog']");
        const cardInBacklog = backlogCol.locator(`[data-task-id="${task.id}"]`);
        await expect(cardInBacklog).toBeVisible({ timeout: 1000 });
    });

    // ── DND-9: release outside board makes no tasks.transition call ──────────
    test("DND-9: releasing pointer over no column (outside board) makes no tasks.transition call", async ({
        page,
        api,
        task,
    }) => {
        const calls = api.capture("tasks.transition", {
            task: makeTask({ ...task }),
            executionId: null,
        });

        await navigateToBoard(page);
        const card = page.locator(`[data-task-id="${task.id}"]`);

        await startDragOnCard(page, card);
        // Move far outside the board area (top-left corner of the viewport)
        await page.mouse.move(0, 0, { steps: 5 });
        await page.mouse.up();

        await page.waitForTimeout(200);

        expect(calls).toHaveLength(0);
    });
});
