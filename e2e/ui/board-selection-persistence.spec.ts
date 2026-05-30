/**
 * board-selection-persistence.spec.ts — E2E tests for workspace and board
 * selection persistence across page refreshes.
 *
 * Suites:
 *   BP-E2E — board/workspace persistence via localStorage
 *   WS-NAV — additional workspace navigation persistence test
 */
import { test, expect } from "./fixtures";
import { makeBoard, makeWorkspace, WORKSPACE_KEY } from "./fixtures/mock-data";

const STORAGE_KEY_WORKSPACE = "railyn.activeWorkspaceKey";
const STORAGE_KEY_BOARD = "railyn.activeBoardId";

// ─── BP-E2E — board/workspace persistence ────────────────────────────────────

test.describe("BP-E2E — board/workspace persistence", () => {
    test("BP-E2E-1: seeded localStorage keys restore correct workspace tab and board on load", async ({
        page,
        api,
    }) => {
        const board1 = makeBoard({ id: 1, workspaceKey: "test-workspace", name: "Board One" });
        const board2 = makeBoard({ id: 2, workspaceKey: "ws-2", name: "Board Two" });

        api
            .returns("workspace.list", [
                { key: "test-workspace", name: "Test Workspace" },
                { key: "ws-2", name: "Workspace 2" },
            ])
            .handle("workspace.getConfig", ({ workspaceKey }) =>
                makeWorkspace({ key: workspaceKey ?? "test-workspace" }),
            )
            .returns("boards.list", [board1, board2]);

        // Seed localStorage before page load
        await page.addInitScript((keys) => {
            localStorage.setItem(keys.workspace, JSON.stringify("ws-2"));
            localStorage.setItem(keys.board, JSON.stringify(2));
        }, { workspace: STORAGE_KEY_WORKSPACE, board: STORAGE_KEY_BOARD });

        await page.goto("/");

        // The "Workspace 2" tab should be active
        await expect(page.locator(".workspace-tab", { hasText: "Workspace 2" })).toHaveClass(/is-active/);

        // The board selector should show "Board Two"
        await expect(page.locator(".board-selector")).toContainText("Board Two");
    });

    test("BP-E2E-2: empty localStorage defaults to first workspace and first board", async ({
        page,
        api,
    }) => {
        const board = makeBoard({ id: 1, workspaceKey: "test-workspace", name: "First Board" });
        api
            .returns("workspace.list", [
                { key: "test-workspace", name: "Test Workspace" },
                { key: "ws-2", name: "Workspace 2" },
            ])
            .handle("workspace.getConfig", ({ workspaceKey }) =>
                makeWorkspace({ key: workspaceKey ?? "test-workspace" }),
            )
            .returns("boards.list", [board]);

        await page.goto("/");

        // First workspace tab should be active
        await expect(page.locator(".workspace-tab", { hasText: "Test Workspace" })).toHaveClass(/is-active/);

        // First board should be selected
        await expect(page.locator(".board-selector")).toContainText("First Board");
    });

    test("BP-E2E-3: clicking a workspace tab persists the key to localStorage", async ({
        page,
        api,
    }) => {
        api
            .returns("workspace.list", [
                { key: "test-workspace", name: "Test Workspace" },
                { key: "ws-2", name: "Workspace 2" },
            ])
            .handle("workspace.getConfig", ({ workspaceKey }) =>
                makeWorkspace({ key: workspaceKey ?? "test-workspace" }),
            );

        await page.goto("/");

        // Click the second workspace tab
        await page.locator(".workspace-tab", { hasText: "Workspace 2" }).click();

        // Wait for state update to flush
        await page.waitForTimeout(200);

        const persisted = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY_WORKSPACE);
        expect(persisted).toBe(JSON.stringify("ws-2"));
    });

    test("BP-E2E-4: selecting a board from the dropdown persists its id to localStorage", async ({
        page,
        api,
    }) => {
        const board1 = makeBoard({ id: 1, name: "Board One" });
        const board2 = makeBoard({ id: 2, name: "Board Two" });

        api
            .returns("boards.list", [board1, board2])
            .handle("workspace.getConfig", () => makeWorkspace());

        await page.goto("/");

        // Open the board selector dropdown and choose second board
        await page.locator(".board-selector").click();
        await page.locator(".p-select-overlay .p-select-option", { hasText: "Board Two" }).click();

        await page.waitForTimeout(200);

        const persisted = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY_BOARD);
        expect(persisted).toBe(JSON.stringify(2));
    });

    test("BP-E2E-5: stale workspace key in localStorage falls back to first workspace", async ({
        page,
        api,
    }) => {
        api
            .returns("workspace.list", [{ key: "test-workspace", name: "Test Workspace" }])
            .handle("workspace.getConfig", () => makeWorkspace());

        await page.addInitScript((key) => {
            localStorage.setItem(key, JSON.stringify("deleted-workspace"));
        }, STORAGE_KEY_WORKSPACE);

        await page.goto("/");

        // Should fall back to first workspace
        await expect(page.locator(".workspace-tab", { hasText: "Test Workspace" })).toHaveClass(/is-active/);
    });

    test("BP-E2E-6: stale board id in localStorage falls back to first board of active workspace", async ({
        page,
        api,
    }) => {
        const board = makeBoard({ id: 5, name: "Real Board" });

        api
            .returns("boards.list", [board])
            .handle("workspace.getConfig", () => makeWorkspace());

        await page.addInitScript((key) => {
            localStorage.setItem(key, JSON.stringify(9999));
        }, STORAGE_KEY_BOARD);

        await page.goto("/");

        // Should show the actual first board, not a blank/broken state
        await expect(page.locator(".board-selector")).toContainText("Real Board");
    });
});
