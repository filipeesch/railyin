/**
 * board-create-task.spec.ts — Task creation via the TaskDetailOverlay.
 *
 * Tests run against dist/ (vite preview). No real backend.
 */

import { test, expect } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";
import { makeTask, makeProject, BOARD_ID } from "./fixtures/mock-data";

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
});
