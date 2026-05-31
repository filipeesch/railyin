import { test, expect } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";
import { makeChatSession, makeBoard, makeWorkspace } from "./fixtures/mock-data";

test.describe("WS reconnect session state", () => {
    test("WS-REC-1: chatSessions.list is called after WebSocket reconnects", async ({ page, api, ws }) => {
        api.returns("workspace.list", [{ key: "test-workspace", name: "Test Workspace" }]);
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? "test-workspace" }),
        );

        const sessionCalls = api.capture("chatSessions.list", []);

        await navigateToBoard(page);

        // Clear initial mount call
        sessionCalls.length = 0;

        // Simulate WS drop — browser will reconnect after ~250ms backoff
        ws.disconnect();

        // onWsReconnect fires on the next successful connect → loadSessions() is called
        await expect.poll(() => sessionCalls.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
    });

    test("WS-REC-2: no duplicate sessions after reload on reconnect", async ({ page, api, ws }) => {
        api.returns("workspace.list", [{ key: "test-workspace", name: "Test Workspace" }]);
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? "test-workspace" }),
        );

        const session1 = makeChatSession({ id: 1, workspaceKey: "test-workspace", title: "Session Alpha" });
        const session2 = makeChatSession({ id: 2, workspaceKey: "test-workspace", title: "Session Beta" });

        api.handle("chatSessions.list", () => [session1, session2]);

        await navigateToBoard(page);

        // Open the chat sidebar so sessions are visible in the DOM
        const sidebarToggle = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
        if (await sidebarToggle.count() > 0) await sidebarToggle.first().click();
        await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });

        // Both sessions visible before disconnect
        await expect(page.locator(".session-item", { hasText: "Session Alpha" })).toBeVisible();
        await expect(page.locator(".session-item", { hasText: "Session Beta" })).toBeVisible();

        // Set up capture for post-reconnect call
        const sessionCalls = api.capture("chatSessions.list", [session1, session2]);

        // Simulate WS drop
        ws.disconnect();

        // Wait for reconnect to trigger chatSessions.list
        await expect.poll(() => sessionCalls.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);

        // Verify no duplicates — still exactly 2 session items
        await expect(page.locator(".session-item")).toHaveCount(2, { timeout: 3_000 });
    });

    test("WS-REC-3: session list reflects updated data after reconnect reload", async ({ page, api, ws }) => {
        api.returns("workspace.list", [{ key: "test-workspace", name: "Test Workspace" }]);
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? "test-workspace" }),
        );

        const sessionA = makeChatSession({ id: 1, workspaceKey: "test-workspace", title: "Session Old" });
        const sessionA_new = makeChatSession({ id: 1, workspaceKey: "test-workspace", title: "Session Updated" });
        const sessionB = makeChatSession({ id: 2, workspaceKey: "test-workspace", title: "Session New" });

        let postReconnect = false;
        api.handle("chatSessions.list", () =>
            postReconnect ? [sessionA_new, sessionB] : [sessionA],
        );

        await navigateToBoard(page);

        // Open the chat sidebar
        const sidebarToggle = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
        if (await sidebarToggle.count() > 0) await sidebarToggle.first().click();
        await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });

        // Before disconnect: only Session Old visible
        await expect(page.locator(".session-item", { hasText: "Session Old" })).toBeVisible();

        // Switch to updated data and simulate reconnect
        postReconnect = true;
        ws.disconnect();

        // After reconnect, the updated session list is loaded
        await expect(page.locator(".session-item", { hasText: "Session Updated" })).toBeVisible({ timeout: 5_000 });
        await expect(page.locator(".session-item", { hasText: "Session New" })).toBeVisible({ timeout: 5_000 });
        await expect(page.locator(".session-item", { hasText: "Session Old" })).not.toBeVisible();
    });
});
