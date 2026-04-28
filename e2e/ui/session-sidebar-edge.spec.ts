/**
 * session-sidebar-edge.spec.ts — Edge case tests for the session chat sidebar.
 *
 * Suite: SE — session sidebar edge cases
 * Tests cover: auto-title display, blur-to-rename without Enter,
 * and reactive session reordering on WS update.
 */

import { test, expect } from "./fixtures";
import { openSidebar, openSessionDrawer } from "./fixtures";
import { makeChatSession } from "./fixtures/mock-data";

test.describe("SE — session sidebar edge cases", () => {
    test("SE-1: auto-title format appears in sidebar", async ({ page, api }) => {
        const session = makeChatSession({ id: 401, title: "Chat – Apr 21" });
        api.returns("chatSessions.list", [session]);

        await page.goto("/");
        await openSidebar(page);

        await expect(page.locator(`[data-session-id="${session.id}"]`)).toContainText("Chat – Apr 21");
    });

    test("SE-2: blur commits session rename without pressing Enter", async ({ page, api }) => {
        const session = makeChatSession({ id: 402, title: "Old Name" });
        api.returns("chatSessions.list", [session]);
        api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));
        const renameCalls = api.capture("chatSessions.rename", undefined);

        await page.goto("/");
        await openSessionDrawer(page, session.id);

        // Click the title to start editing
        await page.locator(".scv-header__title").click();
        await page.keyboard.press("Control+A");
        await page.keyboard.type("New Name");

        // Blur by clicking elsewhere (not Enter)
        await page.locator(".session-chat-view").click({ position: { x: 10, y: 300 } });
        await page.waitForTimeout(300);

        expect(renameCalls.length).toBeGreaterThanOrEqual(1);
    });

    test("SE-3: session moves to top after WS update with newer lastActivityAt", async ({ page, api, ws }) => {
        const now = Date.now();
        const sessionA = makeChatSession({
            id: 403,
            title: "Session A",
            lastActivityAt: new Date(now - 10_000).toISOString(),
        });
        const sessionB = makeChatSession({
            id: 404,
            title: "Session B",
            lastActivityAt: new Date(now).toISOString(),
        });

        api.returns("chatSessions.list", [sessionA, sessionB]);
        api.handle("conversations.getMessages", () => ({ messages: [], hasMore: false }));

        await page.goto("/");
        await openSidebar(page);

        // Initially sessionB should be first (it's newer)
        const items = page.locator(".chat-sidebar [data-session-id]");
        await expect(items.first()).toHaveAttribute("data-session-id", "404");

        // Push update to sessionA with a far-future timestamp
        ws.pushChatSessionUpdated({
            ...sessionA,
            lastActivityAt: new Date(now + 100_000).toISOString(),
        });

        // sessionA should now be first
        await expect(items.first()).toHaveAttribute("data-session-id", "403", { timeout: 3_000 });
    });
});
