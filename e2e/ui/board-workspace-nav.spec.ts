import { test, expect } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";
import { makeWorkspace } from "./fixtures/mock-data";

test.describe("Board workspace navigation", () => {
    test("WS-NAV-1: clicking a workspace tab sets it as active (is-active class)", async ({
        page,
        api,
    }) => {
        // Two workspaces so both tabs render
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        // Handle workspace.getConfig dynamically for either key
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({
                key: workspaceKey ?? "test-workspace",
                name: workspaceKey === "ws-2" ? "Workspace 2" : "Test Workspace",
            }),
        );

        await navigateToBoard(page);

        const tab1 = page.locator(".workspace-tab", { hasText: "Test Workspace" });
        const tab2 = page.locator(".workspace-tab", { hasText: "Workspace 2" });

        await expect(tab1).toBeVisible();
        await expect(tab2).toBeVisible();

        // Initially the first workspace is active
        await expect(tab1).toHaveClass(/is-active/);
        await expect(tab2).not.toHaveClass(/is-active/);

        // Click the second workspace tab
        await tab2.click();

        // Second tab becomes active; first tab loses active class
        await expect(tab2).toHaveClass(/is-active/);
        await expect(tab1).not.toHaveClass(/is-active/);
    });

    test("WS-NAV-2: switching workspaces calls workspace.getConfig for the new workspace", async ({
        page,
        api,
    }) => {
        // Two workspaces
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        // Capture all workspace.getConfig calls to verify the new key is requested
        const configCalls = api.capture("workspace.getConfig", makeWorkspace({ key: "ws-2", name: "Workspace 2" }));

        await navigateToBoard(page);

        const tab2 = page.locator(".workspace-tab", { hasText: "Workspace 2" });
        await expect(tab2).toBeVisible();

        // Clear calls recorded during initial load so we only watch post-click calls
        configCalls.length = 0;

        // Click the second workspace tab — triggers selectWorkspace → load() → workspace.getConfig
        await tab2.click();

        // workspace.getConfig should be called with the new workspace key
        await expect.poll(() => configCalls.length).toBeGreaterThanOrEqual(1);
        expect(configCalls.some((p) => p.workspaceKey === "ws-2")).toBe(true);
    });
});
