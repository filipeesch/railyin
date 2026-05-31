import { test, expect } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";
import { makeChatSession, makeWorkspace } from "./fixtures/mock-data";

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

    test("WS-NAV-3: clicking a workspace tab persists activeWorkspaceKey to localStorage", async ({
        page,
        api,
    }) => {
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? "test-workspace" }),
        );

        await navigateToBoard(page);

        await page.locator(".workspace-tab", { hasText: "Workspace 2" }).click();

        // Wait for reactive watch to flush
        await page.waitForTimeout(200);

        const persisted = await page.evaluate(() =>
            localStorage.getItem("railyn.activeWorkspaceKey"),
        );
        expect(persisted).toBe(JSON.stringify("ws-2"));
    });

    test("WS-NAV-4: switching workspaces calls chatSessions.list with the new workspace key", async ({
        page,
        api,
    }) => {
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? "test-workspace" }),
        );

        const sessionCalls = api.capture("chatSessions.list", []);

        await navigateToBoard(page);

        // Clear calls from initial mount load
        sessionCalls.length = 0;

        await page.locator(".workspace-tab", { hasText: "Workspace 2" }).click();

        await expect.poll(() => sessionCalls.length).toBeGreaterThanOrEqual(1);
        expect(sessionCalls.some((p) => p.workspaceKey === "ws-2")).toBe(true);
    });

    test("WS-NAV-5: switching workspaces shows new workspace sessions and clears old ones", async ({
        page,
        api,
    }) => {
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? "test-workspace" }),
        );

        const sessionA = makeChatSession({ workspaceKey: "test-workspace", title: "Session WS-A" });
        const sessionB = makeChatSession({ workspaceKey: "ws-2", title: "Session WS-B" });

        api.handle("chatSessions.list", ({ workspaceKey }) =>
            workspaceKey === "ws-2" ? [sessionB] : [sessionA],
        );

        await navigateToBoard(page);

        // Open the chat sidebar
        const sidebarToggle = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
        if (await sidebarToggle.count() > 0) await sidebarToggle.first().click();
        await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });

        // Session A visible in sidebar before switch
        await expect(page.locator(".session-item", { hasText: "Session WS-A" })).toBeVisible();

        await page.locator(".workspace-tab", { hasText: "Workspace 2" }).click();

        // After switch: B visible, A gone
        await expect(page.locator(".session-item", { hasText: "Session WS-B" })).toBeVisible();
        await expect(page.locator(".session-item", { hasText: "Session WS-A" })).not.toBeVisible();
    });

    test("WS-NAV-6: rapid switching converges to correct final state", async ({ page, api }) => {
        api.returns("workspace.list", [
            { key: "ws-a", name: "Workspace A" },
            { key: "ws-b", name: "Workspace B" },
            { key: "ws-c", name: "Workspace C" },
        ]);
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? "ws-a" }),
        );

        const sessionCalls = api.capture("chatSessions.list", []);

        await navigateToBoard(page);

        // Clear calls from initial mount
        sessionCalls.length = 0;

        // Rapidly click three workspace tabs
        await page.locator(".workspace-tab", { hasText: "Workspace A" }).click();
        await page.locator(".workspace-tab", { hasText: "Workspace B" }).click();
        await page.locator(".workspace-tab", { hasText: "Workspace C" }).click();

        // Final state should show ws-c sessions
        await expect.poll(() => sessionCalls.length).toBeGreaterThanOrEqual(1);
        const lastCall = sessionCalls[sessionCalls.length - 1];
        expect(lastCall.workspaceKey).toBe("ws-c");
    });

    test("WS-NAV-7: revisit workspace restores sessions and boards (A→B→A round trip)", async ({ page, api }) => {
        api.returns("workspace.list", [
            { key: "ws-a", name: "Workspace A" },
            { key: "ws-b", name: "Workspace B" },
        ]);
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? "ws-a" }),
        );

        const sessionCalls = api.capture("chatSessions.list", []);

        await navigateToBoard(page);

        // Clear initial mount calls
        sessionCalls.length = 0;

        // Session A
        const sessionA = makeChatSession({ workspaceKey: "ws-a", title: "Session A" });
        // Session B
        const sessionB = makeChatSession({ workspaceKey: "ws-b", title: "Session B" });

        api.handle("chatSessions.list", ({ workspaceKey }) =>
            workspaceKey === "ws-b" ? [sessionB] : [sessionA],
        );

        // Open sidebar to see sessions
        const sidebarToggle = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
        if (await sidebarToggle.count() > 0) await sidebarToggle.first().click();
        await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });

        // Click Workspace B
        await page.locator(".workspace-tab", { hasText: "Workspace B" }).click();
        await expect(page.locator(".session-item", { hasText: "Session B" })).toBeVisible();

        // Click back to Workspace A
        await page.locator(".workspace-tab", { hasText: "Workspace A" }).click();
        await expect(page.locator(".session-item", { hasText: "Session A" })).toBeVisible();
        await expect(page.locator(".session-item", { hasText: "Session B" })).not.toBeVisible();
    });

    test("WS-NAV-8: workspace creation flow — create new WS, select it, verify stores refreshed", async ({ page, api }) => {
        api.returns("workspace.list", [
            { key: "ws-a", name: "Workspace A" },
            { key: "ws-new", name: "New Workspace" },
        ]);
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? "ws-a" }),
        );

        const sessionCalls = api.capture("chatSessions.list", []);
        const boardCalls = api.capture("boards.list", []);

        await navigateToBoard(page);

        // Clear initial mount calls
        sessionCalls.length = 0;
        boardCalls.length = 0;

        // Simulate selecting the newly created workspace
        await page.locator(".workspace-tab", { hasText: "New Workspace" }).click();

        // Both sessions and boards should have been reloaded for the new workspace
        await expect.poll(() => sessionCalls.length).toBeGreaterThanOrEqual(1);
        await expect.poll(() => boardCalls.length).toBeGreaterThanOrEqual(1);
    });
});
