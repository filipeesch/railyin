/**
 * chat-workspace-scoping.spec.ts — UI tests for workspace-scoped chat sessions.
 *
 * Suites:
 *   CS-H — Workspace switching and session isolation
 *
 * Backend is fully mocked via ApiMock + WsMock fixtures.
 */

import { test, expect } from "./fixtures";
import { makeChatSession, WORKSPACE_KEY } from "./fixtures/mock-data";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function openSidebar(page: import("@playwright/test").Page) {
    const btn = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
    if (await btn.count() > 0) {
        await btn.first().click();
    }
    await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });
}

async function seedWorkspaceKey(page: import("@playwright/test").Page, key: string) {
    await page.addInitScript((k: string) => {
        localStorage.setItem("railyn.activeWorkspaceKey", JSON.stringify(k));
    }, key);
}

// ─── Suite CS-H — Chat workspace scoping ──────────────────────────────────────

test.describe("CS-H — Chat workspace scoping", () => {
    test("CS-H-1: sessions from wsA hidden when viewing wsB", async ({ page, api }) => {
        // Two workspaces available
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        // ws-2 only has one session; test-workspace has two (one visible, one not shown here)
        const ws2Session = makeChatSession({ id: 500, title: "Ws2 Session", workspaceKey: "ws-2" });
        api.returns("chatSessions.list", [ws2Session]);

        // Navigate with ws-2 as active workspace
        await seedWorkspaceKey(page, "ws-2");
        await page.goto("/");
        await openSidebar(page);

        // Only ws-2's session should be visible
        await expect(page.locator(".session-item")).toHaveCount(1, { timeout: 3_000 });
        await expect(page.locator(".session-item__title").first()).toContainText("Ws2 Session");
    });

    test("CS-H-2: active session closed on workspace switch", async ({ page, api }) => {
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        // Open a session in test-workspace first
        const session = makeChatSession({ id: 600, title: "Open Session" });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.get", session);
        api.returns("chatSessions.getMessages", { messages: [], hasMore: false });

        await page.goto("/");
        await openSidebar(page);
        await page.locator(`[data-session-id="${session.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });

        // Click workspace tab to switch
        await page.locator(".workspace-tab", { hasText: "Workspace 2" }).click();

        // Drawer should close
        await expect(page.locator(".session-chat-view")).not.toBeVisible({ timeout: 3_000 });

        // No session should be highlighted
        await expect(page.locator(".session-item.is-active")).toHaveCount(0);
    });

    test("CS-H-3: sidebar reloaded after switch shows new workspace sessions", async ({ page, api, ws }) => {
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        // Start with empty list (ws-A)
        api.returns("chatSessions.list", []);

        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".session-item")).toHaveCount(0);

        // Push a session for ws-2
        const ws2Session = makeChatSession({ id: 700, title: "Pushed Ws2 Session", workspaceKey: "ws-2" });
        ws.pushChatSessionCreated(ws2Session);

        // Switch to ws-2
        await page.locator(".workspace-tab", { hasText: "Workspace 2" }).click();

        // Should now show the pushed session
        await expect(page.locator(".session-item")).toHaveCount(1, { timeout: 3_000 });
        await expect(page.locator(".session-item__title").first()).toContainText("Pushed Ws2 Session");
    });

    test("CS-H-4: creating session in ws-2 sets correct workspaceKey", async ({ page, api, ws }) => {
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        const newSession = makeChatSession({ id: 800, title: "New Chat", workspaceKey: "ws-2" });
        api.returns("chatSessions.list", []);
        let capturedCreateParams: unknown | undefined;
        api.handle("chatSessions.create", (params: unknown) => {
            capturedCreateParams = params;
            setTimeout(() => ws.pushChatSessionCreated(newSession), 50);
            return newSession;
        });
        api.returns("chatSessions.getMessages", { messages: [], hasMore: false });

        // Seed ws-2 as active
        await seedWorkspaceKey(page, "ws-2");
        await page.goto("/");
        await openSidebar(page);

        // Create new session
        await page.locator("button[aria-label='New chat session']").click();
        await page.waitForTimeout(200);

        // Verify the API call included workspaceKey: "ws-2"
        expect(capturedCreateParams).toBeDefined();
        const params = capturedCreateParams as { workspaceKey?: string };
        expect(params.workspaceKey).toBe("ws-2");
    });

    test("CS-H-5: archived sessions from other workspace don't leak", async ({ page, api }) => {
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        // Return an archived session with different workspaceKey
        const archived = makeChatSession({
            id: 900,
            title: "Archived From Ws-A",
            workspaceKey: "test-workspace",
            status: "archived",
            archivedAt: new Date().toISOString(),
        });

        // ws-2 has its own non-archived session
        const ws2Session = makeChatSession({ id: 901, title: "Ws2 Active", workspaceKey: "ws-2" });
        api.returns("chatSessions.list", [ws2Session, archived]);

        // Navigate to ws-2
        await seedWorkspaceKey(page, "ws-2");
        await page.goto("/");
        await openSidebar(page);

        // Archived session from ws-A should NOT appear in ws-2 view
        // The server should only return ws-2 sessions anyway, but verify
        await expect(page.locator(".session-item")).toHaveCount(1, { timeout: 3_000 });
    });

    test("CS-H-6: selecting session from wsB works correctly", async ({ page, api }) => {
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        const ws2Session = makeChatSession({ id: 1000, title: "Select Me", workspaceKey: "ws-2" });
        api.returns("chatSessions.list", [ws2Session]);
        api.returns("chatSessions.get", ws2Session);
        api.returns("chatSessions.getMessages", { messages: [], hasMore: false });

        await seedWorkspaceKey(page, "ws-2");
        await page.goto("/");
        await openSidebar(page);

        // Click the session
        await page.locator(`[data-session-id="${ws2Session.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });
    });

    test("CS-H-7: switching back to original workspace restores sessions", async ({ page, api }) => {
        api.returns("workspace.list", [
            { key: "test-workspace", name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);

        // ws-A has sessions, ws-B is empty
        const wsASession = makeChatSession({ id: 1100, title: "WsA Session", workspaceKey: "test-workspace" });
        api.handle("chatSessions.list", ({ workspaceKey }: { workspaceKey?: string }) => {
            if (workspaceKey === "test-workspace") {
                return [wsASession];
            }
            return [];
        });
        api.returns("chatSessions.getMessages", { messages: [], hasMore: false });

        // Start in ws-A
        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".session-item")).toHaveCount(1);

        // Switch to ws-B
        await page.locator(".workspace-tab", { hasText: "Workspace 2" }).click();
        await expect(page.locator(".session-item")).toHaveCount(0, { timeout: 3_000 });

        // Switch back to ws-A
        await page.locator(".workspace-tab", { hasText: "Test Workspace" }).click();

        // Sessions should be restored
        await expect(page.locator(".session-item")).toHaveCount(1, { timeout: 3_000 });
        await expect(page.locator(".session-item__title").first()).toContainText("WsA Session");
    });
});
