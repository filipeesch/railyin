/**
 * board-create-task.spec.ts — Task creation via the TaskDetailOverlay.
 *
 * Tests run against dist/ (vite preview). No real backend.
 */

import { test, expect } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";
import { makeTask, makeProject, BOARD_ID } from "./fixtures/mock-data";
import type { Task } from "@shared/rpc-types";

// ─── Suite CREATE — Task creation overlay ────────────────────────────────────

test.describe("CREATE — task creation overlay", () => {
    test("CREATE-1: clicking 'New Task' button opens the task creation overlay", async ({
        page,
    }) => {
        await navigateToBoard(page);

        await page.locator("[data-column-id='backlog'] .board-column__create-task button").click();

        await expect(page.locator(".task-overlay")).toBeVisible({ timeout: 3_000 });
    });

    test("CREATE-2: filling title and clicking Save calls tasks.create with correct boardId and title", async ({
        page,
        api,
    }) => {
        // New tasks require a projectKey — expose one project in the mock
        api.returns("projects.list", [makeProject()]);
        const calls = api.capture("tasks.create", makeTask({ title: "My New Task" }));

        await navigateToBoard(page);

        // Open overlay
        await page.locator("[data-column-id='backlog'] .board-column__create-task button").click();
        await expect(page.locator(".task-overlay")).toBeVisible({ timeout: 3_000 });

        // Fill title
        await page.locator("#task-title").fill("My New Task");

        // Select project (required for the Save button to become enabled)
        await page.locator("#task-project").click();
        await page.getByRole("option", { name: "Test Project" }).click();

        // Save — button is now enabled (title non-empty + project selected)
        await page.locator(".task-overlay button:has-text('Save')").click();

        // tasks.create must have been called exactly once with the right payload
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ boardId: BOARD_ID, title: "My New Task" });

        // Overlay should close after save
        await expect(page.locator(".task-overlay")).not.toBeVisible({ timeout: 3_000 });
    });

    test("CREATE-3: clicking Save with empty title does NOT call tasks.create", async ({
        page,
        api,
    }) => {
        const calls = api.capture("tasks.create", makeTask({ title: "" }));

        await navigateToBoard(page);

        // Open overlay
        await page.locator("[data-column-id='backlog'] .board-column__create-task button").click();
        await expect(page.locator(".task-overlay")).toBeVisible({ timeout: 3_000 });

        // Leave title empty and try to click Save
        // The Save button is disabled when title is empty (`:disabled="!form.title.trim()"`)
        // so we verify the button is disabled and the API was not called.
        const saveButton = page.locator(".task-overlay button:has-text('Save')");
        await expect(saveButton).toBeDisabled();

        // tasks.create must NOT have been called
        expect(calls).toHaveLength(0);
    });

    test("CREATE-4: newly created task card appears first in backlog column", async ({
        page,
        api,
        ws,
    }) => {
        // Seed the board with an existing task at position 1000
        const existingTask = makeTask({ id: 1, workflowState: "backlog", position: 1000 });
        api.handle("tasks.list", () => [existingTask]);

        // The new task is returned by tasks.create with a lower position (250 < 1000)
        const newTask = makeTask({ id: 2, title: "Brand New", workflowState: "backlog", position: 250 });
        api.returns("projects.list", [makeProject()]);
        api.capture("tasks.create", newTask);

        await navigateToBoard(page);

        // Existing card should be visible
        await expect(page.locator(`[data-task-id="${existingTask.id}"]`)).toBeVisible({ timeout: 3_000 });

        // Simulate server push for the newly created task
        ws.push({ type: "task.updated", payload: newTask });

        const backlogColumn = page.locator("[data-column-id='backlog']");
        await expect(backlogColumn.locator(`[data-task-id="${newTask.id}"]`)).toBeVisible({ timeout: 3_000 });

        // newTask (position 250) must appear before existingTask (position 1000)
        const cardIds = await backlogColumn.locator("[data-task-id]").evaluateAll(
            (els) => els.map((el) => Number(el.getAttribute("data-task-id"))),
        );
        expect(cardIds.indexOf(newTask.id)).toBeLessThan(cardIds.indexOf(existingTask.id));
    });

    test("CREATE-5: AI-created task pushed via WebSocket appears first in backlog", async ({
        page,
        api,
        ws,
    }) => {
        // Seed board with one existing task at position 1000
        const existingTask = makeTask({ id: 1, workflowState: "backlog", position: 1000 });
        api.handle("tasks.list", () => [existingTask]);

        await navigateToBoard(page);
        await expect(page.locator(`[data-task-id="${existingTask.id}"]`)).toBeVisible({ timeout: 3_000 });

        // AI-created task arrives via WebSocket with a lower position (0.5 < 1000)
        const aiTask: Task = makeTask({ id: 2, title: "AI Task", workflowState: "backlog", position: 0.5 });
        ws.push({ type: "task.updated", payload: aiTask });

        const backlogColumn = page.locator("[data-column-id='backlog']");
        await expect(backlogColumn.locator(`[data-task-id="${aiTask.id}"]`)).toBeVisible({ timeout: 3_000 });

        // aiTask (position 0.5) must appear before existingTask (position 1000)
        const cardIds = await backlogColumn.locator("[data-task-id]").evaluateAll(
            (els) => els.map((el) => Number(el.getAttribute("data-task-id"))),
        );
        expect(cardIds.indexOf(aiTask.id)).toBeLessThan(cardIds.indexOf(existingTask.id));
    });
});
