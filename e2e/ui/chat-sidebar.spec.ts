/**
 * chat-sidebar.spec.ts — UI tests for the Chat Sessions sidebar.
 *
 * Suites:
 *   CS-A — Sidebar rendering (list, status dots, unread badge)
 *   CS-B — Session creation and naming
 *   CS-C — Session archiving
 *   CS-D — Live WebSocket status updates
 *   CS-E — Sidebar lifecycle (active highlight, archived hidden, width persistence)
 *   CS-F — Unread notification lifecycle
 *   CS-G — Sidebar drag-resize
 *
 * Backend is fully mocked via ApiMock + WsMock fixtures.
 */

import { test, expect } from "./fixtures";
import { makeChatSession, WORKSPACE_KEY } from "./fixtures/mock-data";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function openSidebar(page: import("@playwright/test").Page) {
    // The chat sidebar toggle button has class is-active when open.
    // We look for the button that controls the sidebar.
    const btn = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
    // Try clicking it; if not found, the sidebar may already be in the DOM via auto-open.
    const count = await btn.count();
    if (count > 0) {
        await btn.first().click();
    }
    await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });
}

// ─── Suite CS-A — Sidebar rendering ──────────────────────────────────────────

test.describe("CS-A — Sidebar rendering", () => {
    test("CS-A-1: sidebar is hidden by default on page load", async ({ page, api }) => {
        api.returns("chatSessions.list", []);
        await page.goto("/");
        await expect(page.locator(".chat-sidebar")).not.toBeVisible();
    });

    test("CS-A-2: sidebar opens when the chat toggle button is clicked", async ({ page, api }) => {
        api.returns("chatSessions.list", []);
        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".chat-sidebar")).toBeVisible();
    });

    test("CS-A-2b: sidebar stays open after refresh when persisted in localStorage", async ({ page, api }) => {
        api.returns("chatSessions.list", []);
        await page.goto("/");
        await openSidebar(page);
        await page.reload();
        await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });
    });

    test("CS-A-3: sessions are listed sorted by lastActivityAt DESC", async ({ page, api }) => {
        const older = makeChatSession({ id: 201, title: "Old Chat", lastActivityAt: "2024-01-01T00:00:00.000Z" });
        const newer = makeChatSession({ id: 202, title: "New Chat", lastActivityAt: "2024-06-01T00:00:00.000Z" });
        api.returns("chatSessions.list", [older, newer]); // server returns old-first
        await page.goto("/");
        await openSidebar(page);

        // Sidebar should display newest first
        const items = page.locator(".session-item");
        await expect(items).toHaveCount(2);
        await expect(items.first()).toContainText("New Chat");
        await expect(items.last()).toContainText("Old Chat");
    });

    test("CS-A-4: session title is rendered inside .session-item__title", async ({ page, api }) => {
        const session = makeChatSession({ title: "My Test Session" });
        api.returns("chatSessions.list", [session]);
        await page.goto("/");
        await openSidebar(page);

        await expect(page.locator(".session-item__title").first()).toHaveText("My Test Session");
    });

    test("CS-A-5: idle session has status-dot--idle class", async ({ page, api }) => {
        const session = makeChatSession({ status: "idle" });
        api.returns("chatSessions.list", [session]);
        await page.goto("/");
        await openSidebar(page);

        await expect(page.locator(".session-item__status-dot.status-dot--idle")).toBeVisible();
    });

    test("CS-A-6: running session has status-dot--running class", async ({ page, api }) => {
        const session = makeChatSession({ status: "running" });
        api.returns("chatSessions.list", [session]);
        await page.goto("/");
        await openSidebar(page);

        await expect(page.locator(".session-item__status-dot.status-dot--running")).toBeVisible();
    });

    test("CS-A-7: unread dot shown when lastReadAt is null", async ({ page, api }) => {
        const session = makeChatSession({ lastReadAt: null });
        api.returns("chatSessions.list", [session]);
        await page.goto("/");
        await openSidebar(page);

        await expect(page.locator(".session-item__unread-dot")).toBeVisible();
    });

    test("CS-A-8: unread dot not shown when lastReadAt is set", async ({ page, api }) => {
        const now = new Date().toISOString();
        const session = makeChatSession({ lastReadAt: now });
        api.returns("chatSessions.list", [session]);
        await page.goto("/");
        await openSidebar(page);

        await expect(page.locator(".session-item__unread-dot")).not.toBeVisible();
    });

    test("CS-A-9: empty state shown when no sessions exist", async ({ page, api }) => {
        api.returns("chatSessions.list", []);
        await page.goto("/");
        await openSidebar(page);

        // Sidebar is visible but no session items
        await expect(page.locator(".session-item")).toHaveCount(0);
    });
});

// ─── Suite CS-B — Session creation and naming ─────────────────────────────────

test.describe("CS-B — Session creation and naming", () => {
    test("CS-B-1: New Chat button calls chatSessions.create and adds session to list", async ({ page, api, ws }) => {
        const newSession = makeChatSession({ id: 300, title: "New Chat" });
        api.returns("chatSessions.list", []);
        let createCalled = false;
        api.handle("chatSessions.create", () => {
            createCalled = true;
            // Push WS event so chatStore adds it to list
            setTimeout(() => ws.pushChatSessionCreated(newSession), 50);
            return newSession;
        });
        api.returns("chatSessions.getMessages", []);

        await page.goto("/");
        await openSidebar(page);

        // Click the new chat button
        await page.locator("button[aria-label='New chat session']").click();
        await expect(page.locator(".session-item")).toHaveCount(1, { timeout: 3_000 });
        expect(createCalled).toBe(true);
    });

    test("CS-B-2: clicking New Chat opens the ConversationDrawer in session mode", async ({ page, api, ws }) => {
        const newSession = makeChatSession({ id: 301, title: "New Chat" });
        api.returns("chatSessions.list", []);
        api.handle("chatSessions.create", () => {
            setTimeout(() => ws.pushChatSessionCreated(newSession), 50);
            return newSession;
        });
        api.returns("chatSessions.getMessages", []);

        await page.goto("/");
        await openSidebar(page);

        await page.locator("button[aria-label='New chat session']").click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });
    });

    test("CS-B-3: clicking a session item opens the ConversationDrawer", async ({ page, api }) => {
        const session = makeChatSession({ id: 302, title: "Existing Session" });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.getMessages", []);

        await page.goto("/");
        await openSidebar(page);

        await page.locator(`[data-session-id="${session.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });
    });

    test("CS-B-4: pencil icon triggers inline rename input", async ({ page, api }) => {
        const session = makeChatSession({ id: 303, title: "Rename Me" });
        api.returns("chatSessions.list", [session]);

        await page.goto("/");
        await openSidebar(page);

        // Hover to reveal action buttons
        await page.locator(`[data-session-id="${session.id}"]`).hover();
        await page.locator(`[data-session-id="${session.id}"] .session-item__action-btn`).first().click();

        await expect(page.locator(".session-item__rename-input")).toBeVisible({ timeout: 2_000 });
    });

    test("CS-B-5: pressing Enter in rename input calls chatSessions.rename", async ({ page, api }) => {
        const session = makeChatSession({ id: 304, title: "Old Title" });
        api.returns("chatSessions.list", [session]);
        let renameCalled = false;
        api.handle("chatSessions.rename", () => {
            renameCalled = true;
        });

        await page.goto("/");
        await openSidebar(page);

        await page.locator(`[data-session-id="${session.id}"]`).hover();
        await page.locator(`[data-session-id="${session.id}"] .session-item__action-btn`).first().click();

        const input = page.locator(".session-item__rename-input");
        await input.fill("New Title");
        await input.press("Enter");

        await page.waitForTimeout(200);
        expect(renameCalled).toBe(true);
    });

    test("CS-B-6: pressing Escape cancels rename without calling API", async ({ page, api }) => {
        const session = makeChatSession({ id: 305, title: "Keep Title" });
        api.returns("chatSessions.list", [session]);
        let renameCalled = false;
        api.handle("chatSessions.rename", () => { renameCalled = true; });

        await page.goto("/");
        await openSidebar(page);

        await page.locator(`[data-session-id="${session.id}"]`).hover();
        await page.locator(`[data-session-id="${session.id}"] .session-item__action-btn`).first().click();

        const input = page.locator(".session-item__rename-input");
        await input.press("Escape");

        await page.waitForTimeout(200);
        expect(renameCalled).toBe(false);
        await expect(page.locator(".session-item__rename-input")).not.toBeVisible();
    });
});

// ─── Suite CS-C — Session archiving ───────────────────────────────────────────

test.describe("CS-C — Session archiving", () => {
    test("CS-C-1: archive button calls chatSessions.archive", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 310, title: "Archive Me" });
        api.returns("chatSessions.list", [session]);
        let archiveCalled = false;
        api.handle("chatSessions.archive", () => {
            archiveCalled = true;
            // Server sends back updated session with archived status
            const archived = { ...session, status: "archived" as const, archivedAt: new Date().toISOString() };
            setTimeout(() => ws.pushChatSessionUpdated(archived), 50);
        });

        await page.goto("/");
        await openSidebar(page);

        await page.locator(`[data-session-id="${session.id}"]`).hover();
        // Archive button is typically the second action button
        const actionBtns = page.locator(`[data-session-id="${session.id}"] .session-item__action-btn`);
        await actionBtns.last().click();

        await page.waitForTimeout(300);
        expect(archiveCalled).toBe(true);
    });

    test("CS-C-2: archived session is removed from active list", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 311, title: "To Archive" });
        api.returns("chatSessions.list", [session]);
        api.handle("chatSessions.archive", () => {
            const archived = { ...session, status: "archived" as const, archivedAt: new Date().toISOString() };
            setTimeout(() => ws.pushChatSessionUpdated(archived), 50);
        });

        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".session-item")).toHaveCount(1);

        await page.locator(`[data-session-id="${session.id}"]`).hover();
        await page.locator(`[data-session-id="${session.id}"] .session-item__action-btn`).last().click();

        await expect(page.locator(".session-item")).toHaveCount(0, { timeout: 3_000 });
    });

    test("CS-C-3: archiving the currently-open session closes the drawer", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 312, title: "Open and Archive" });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.getMessages", []);
        api.handle("chatSessions.archive", () => {
            const archived = { ...session, status: "archived" as const, archivedAt: new Date().toISOString() };
            setTimeout(() => ws.pushChatSessionUpdated(archived), 50);
        });

        await page.goto("/");
        await openSidebar(page);

        // Open the drawer first
        await page.locator(`[data-session-id="${session.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 3_000 });

        // Archive from within the drawer (archive button in session header)
        await page.locator(".scv-header__archive-btn, .session-chat-view [data-action='archive']").click();

        await expect(page.locator(".session-chat-view")).not.toBeVisible({ timeout: 3_000 });
    });
});

// ─── Suite CS-D — Live WebSocket status updates ────────────────────────────────

test.describe("CS-D — Live WebSocket status updates", () => {
    test("CS-D-1: chatSession.updated WS event updates status badge", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 320, status: "idle" });
        api.returns("chatSessions.list", [session]);

        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".status-dot--idle")).toBeVisible();

        // Push status change
        ws.pushChatSessionUpdated({ ...session, status: "running" });

        await expect(page.locator(".status-dot--running")).toBeVisible({ timeout: 2_000 });
        await expect(page.locator(".status-dot--idle")).not.toBeVisible();
    });

    test("CS-D-2: chatSession.updated shows unread dot when lastReadAt is null", async ({ page, api, ws }) => {
        const now = new Date().toISOString();
        const session = makeChatSession({ id: 321, lastReadAt: now });
        api.returns("chatSessions.list", [session]);

        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".session-item__unread-dot")).not.toBeVisible();

        ws.pushChatSessionUpdated({ ...session, lastReadAt: null });

        await expect(page.locator(".session-item__unread-dot")).toBeVisible({ timeout: 2_000 });
    });

    test("CS-D-3: chatSession.created WS event adds new session to list", async ({ page, api, ws }) => {
        api.returns("chatSessions.list", []);

        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".session-item")).toHaveCount(0);

        const newSession = makeChatSession({ id: 322, title: "Pushed Session" });
        ws.pushChatSessionCreated(newSession);

        await expect(page.locator(".session-item")).toHaveCount(1, { timeout: 2_000 });
        await expect(page.locator(".session-item__title").first()).toContainText("Pushed Session");
    });

    test("CS-D-4: session title updates in sidebar after rename WS event", async ({ page, api, ws }) => {
        const session = makeChatSession({ id: 323, title: "Before Rename" });
        api.returns("chatSessions.list", [session]);

        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".session-item__title").first()).toHaveText("Before Rename");

        ws.pushChatSessionUpdated({ ...session, title: "After Rename" });

        await expect(page.locator(".session-item__title").first()).toHaveText("After Rename", { timeout: 2_000 });
    });
});

// ─── Suite CS-E — Sidebar lifecycle ───────────────────────────────────────────

test.describe("CS-E — Sidebar lifecycle", () => {
    test("CS-E-1: sidebar stays open after selecting a session (does not auto-close)", async ({ page, api }) => {
        const session = makeChatSession({ id: 330, title: "Stay Open" });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.getMessages", []);

        await page.goto("/");
        await openSidebar(page);
        await expect(page.locator(".chat-sidebar")).toBeVisible();

        await page.locator(`[data-session-id="${session.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });

        // Sidebar must still be visible after selecting a session
        await expect(page.locator(".chat-sidebar")).toBeVisible();
    });

    test("CS-E-2: opened session item has is-active class; others do not", async ({ page, api }) => {
        const s1 = makeChatSession({ id: 331, title: "Session A" });
        const s2 = makeChatSession({ id: 332, title: "Session B" });
        api.returns("chatSessions.list", [s1, s2]);
        api.returns("chatSessions.getMessages", []);

        await page.goto("/");
        await openSidebar(page);

        await page.locator(`[data-session-id="${s1.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });

        await expect(page.locator(`[data-session-id="${s1.id}"]`)).toHaveClass(/is-active/);
        await expect(page.locator(`[data-session-id="${s2.id}"]`)).not.toHaveClass(/is-active/);
    });

    test("CS-E-3: sessions with status 'archived' are hidden from sidebar list", async ({ page, api }) => {
        const active = makeChatSession({ id: 333, title: "Active Session", status: "idle" });
        const archived = makeChatSession({ id: 334, title: "Archived Session", status: "archived", archivedAt: new Date().toISOString() });
        api.returns("chatSessions.list", [active, archived]);

        await page.goto("/");
        await openSidebar(page);

        await expect(page.locator(".session-item")).toHaveCount(1);
        await expect(page.locator(".session-item__title").first()).toHaveText("Active Session");
        await expect(page.locator(`[data-session-id="${archived.id}"]`)).toHaveCount(0);
    });

    test("CS-E-4: sidebar width seeded in localStorage is applied on load", async ({ page, api }) => {
        api.returns("chatSessions.list", []);

        // Seed a custom width before navigation
        await page.addInitScript(() => {
            localStorage.setItem("chat-sidebar-width", "350");
        });

        await page.goto("/");
        await openSidebar(page);

        const sidebar = page.locator(".chat-sidebar");
        const box = await sidebar.boundingBox();
        expect(box).not.toBeNull();
        // Width should be ~350px (allow ±5 for borders)
        expect(box!.width).toBeGreaterThanOrEqual(345);
        expect(box!.width).toBeLessThanOrEqual(360);
    });
});

// ─── Suite CS-F — Unread notification lifecycle ───────────────────────────────

test.describe("CS-F — Unread notification lifecycle", () => {
    test("CS-F-1: chatSessions.markRead is called when a session is opened", async ({ page, api }) => {
        const session = makeChatSession({ id: 340, title: "Mark Me Read" });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.getMessages", []);

        const markReadCalls = api.capture("chatSessions.markRead", undefined);

        await page.goto("/");
        await openSidebar(page);

        await page.locator(`[data-session-id="${session.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });

        await page.waitForTimeout(300);
        expect(markReadCalls.length).toBeGreaterThanOrEqual(1);
        expect((markReadCalls[0] as { sessionId: number }).sessionId).toBe(session.id);
    });

    test("CS-F-2: unread dot disappears after opening the session", async ({ page, api, ws }) => {
        const now = new Date().toISOString();
        const session = makeChatSession({ id: 341, lastReadAt: now });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.getMessages", []);
        api.returns("chatSessions.markRead", undefined);

        await page.goto("/");
        await openSidebar(page);

        // Push an update that marks session as unread
        ws.pushChatSessionUpdated({ ...session, lastReadAt: null });
        await expect(page.locator(`.session-item__unread-dot`)).toBeVisible({ timeout: 2_000 });

        // Open the session — should clear the unread dot
        await page.locator(`[data-session-id="${session.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });

        await expect(page.locator(`.session-item__unread-dot`)).not.toBeVisible({ timeout: 2_000 });
    });

    test("CS-F-3: active (open) session does NOT get unread dot from WS push", async ({ page, api, ws }) => {
        const now = new Date().toISOString();
        const session = makeChatSession({ id: 342, lastReadAt: now });
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.getMessages", []);
        api.returns("chatSessions.markRead", undefined);

        await page.goto("/");
        await openSidebar(page);

        // Open the session (it becomes active)
        await page.locator(`[data-session-id="${session.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });

        // Push an update for the ACTIVE session with lastReadAt=null
        ws.pushChatSessionUpdated({ ...session, lastReadAt: null, status: "idle" });

        // Wait a tick — unread dot should NOT appear for the currently active session
        await page.waitForTimeout(500);
        await expect(page.locator(`.session-item__unread-dot`)).not.toBeVisible();
    });
});

// ─── Suite CS-G — Sidebar drag-resize ─────────────────────────────────────────

test.describe("CS-G — Sidebar drag-resize", () => {
    test("CS-G-1: dragging the resize handle changes sidebar width and persists to localStorage", async ({ page, api }) => {
        api.returns("chatSessions.list", []);

        await page.goto("/");
        await openSidebar(page);

        const handle = page.locator(".chat-sidebar__resize-handle");
        await expect(handle).toBeVisible();

        const box = await handle.boundingBox();
        expect(box).not.toBeNull();

        const startX = box!.x + box!.width / 2;
        const startY = box!.y + box!.height / 2;

        // Drag left by 80px to make sidebar wider
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX - 80, startY, { steps: 10 });
        await page.mouse.up();

        // Wait for the debounce/update
        await page.waitForTimeout(200);

        const stored = await page.evaluate(() => localStorage.getItem("chat-sidebar-width"));
        expect(stored).not.toBeNull();
        expect(Number(stored)).toBeGreaterThan(220); // default is 220
    });

    test("CS-G-2: sidebar width is clamped at max (400px) and min (160px)", async ({ page, api }) => {
        api.returns("chatSessions.list", []);

        // Start at a wide width (near max)
        await page.addInitScript(() => {
            localStorage.setItem("chat-sidebar-width", "380");
        });

        await page.goto("/");
        await openSidebar(page);

        const handle = page.locator(".chat-sidebar__resize-handle");
        const box = await handle.boundingBox();
        expect(box).not.toBeNull();

        const cx = box!.x + box!.width / 2;
        const cy = box!.y + box!.height / 2;

        // Drag way left to try to exceed max
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx - 200, cy, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(200);

        let stored = Number(await page.evaluate(() => localStorage.getItem("chat-sidebar-width")));
        expect(stored).toBeLessThanOrEqual(400);

        // Drag way right to try to go below min
        const box2 = await handle.boundingBox();
        const cx2 = box2!.x + box2!.width / 2;
        await page.mouse.move(cx2, cy);
        await page.mouse.down();
        await page.mouse.move(cx2 + 500, cy, { steps: 20 });
        await page.mouse.up();
        await page.waitForTimeout(200);

        stored = Number(await page.evaluate(() => localStorage.getItem("chat-sidebar-width")));
        expect(stored).toBeGreaterThanOrEqual(160);
    });
});
