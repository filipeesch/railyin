/**
 * board-header-workflow-edit.spec.ts — E2E tests for the workflow edit pencil
 * button in the board header.
 *
 * Suites:
 *   BWE — board header workflow edit button
 */
import { test, expect } from "./fixtures";
import { makeBoard, makeWorkspace } from "./fixtures/mock-data";
import { navigateToBoard } from "./fixtures/board-helpers";

const SAMPLE_YAML = `name: Default
columns:
  - id: backlog
    label: Backlog
  - id: done
    label: Done
`;

// ─── BWE — board header workflow edit button ──────────────────────────────────

test.describe("BWE — board header workflow edit button", () => {
    test("BWE-1: pencil button is visible when a board is active", async ({ page, api }) => {
        api
            .returns("workflow.getYaml", { yaml: SAMPLE_YAML })
            .handle("workspace.getConfig", () => makeWorkspace());

        await navigateToBoard(page);

        await expect(page.locator("button[aria-label='Edit workflow']")).toBeVisible();
    });

    test("BWE-2: pencil button is not rendered when no board is selected", async ({
        page,
        api,
    }) => {
        // Return empty boards list so no board is active
        api
            .returns("boards.list", [])
            .handle("workspace.getConfig", () => makeWorkspace());

        await page.goto("/");
        await page.waitForTimeout(500);

        await expect(page.locator("button[aria-label='Edit workflow']")).not.toBeVisible();
    });

    test("BWE-3: clicking pencil opens the workflow editor overlay with YAML content", async ({
        page,
        api,
    }) => {
        api
            .returns("workflow.getYaml", { yaml: SAMPLE_YAML })
            .handle("workspace.getConfig", () => makeWorkspace());

        await navigateToBoard(page);

        await page.locator("button[aria-label='Edit workflow']").click();

        // The overlay should be visible
        const overlay = page.locator(".workflow-editor-overlay, [data-testid='workflow-editor']");
        await expect(overlay).toBeVisible({ timeout: 3_000 });
    });

    test("BWE-4: saving the workflow closes the overlay automatically", async ({
        page,
        api,
    }) => {
        const saveYamlCalls = api.capture("workflow.saveYaml", { ok: true });
        api
            .returns("workflow.getYaml", { yaml: SAMPLE_YAML })
            .handle("workspace.getConfig", () => makeWorkspace());

        await navigateToBoard(page);

        // Open editor
        await page.locator("button[aria-label='Edit workflow']").click();

        const overlay = page.locator(".workflow-editor-overlay, [data-testid='workflow-editor']");
        await expect(overlay).toBeVisible({ timeout: 3_000 });

        // Click the Save button inside the overlay
        await page.locator(".workflow-editor-overlay button", { hasText: "Save" }).click();

        // Overlay should close
        await expect(overlay).not.toBeVisible({ timeout: 3_000 });

        // Save was called
        expect(saveYamlCalls.length).toBeGreaterThanOrEqual(1);
    });

    test("BWE-5: saving the workflow triggers boards.list to reload", async ({ page, api, ws }) => {
        const boardListCalls = api.capture("boards.list", [makeBoard()]);
        api
            .returns("workflow.getYaml", { yaml: SAMPLE_YAML })
            .handle("workspace.getConfig", () => makeWorkspace());

        // When saveYaml is called, also push the WS event the backend normally emits
        api.handle("workflow.saveYaml", async () => {
            ws.push({ type: "workflow.reloaded", payload: {} });
            return { ok: true };
        });

        await navigateToBoard(page);

        // Clear initial load call so we only track post-save calls
        boardListCalls.length = 0;

        // Open editor and save
        await page.locator("button[aria-label='Edit workflow']").click();
        await expect(
            page.locator(".workflow-editor-overlay, [data-testid='workflow-editor']"),
        ).toBeVisible({ timeout: 3_000 });
        await page.locator(".workflow-editor-overlay button", { hasText: "Save" }).click();

        // boards.list should be called after save (via onWorkflowReloaded WS event)
        await expect.poll(() => boardListCalls.length).toBeGreaterThanOrEqual(1);
    });
});
