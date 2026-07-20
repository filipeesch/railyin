/**
 * session-chat-notes.spec.ts — Playwright UI tests for the Notes tab in session chat.
 *
 * Tests the Notes tab in the session detail drawer:
 *   CSN-1: Notes tab button is visible
 *   CSN-2: Notes tab shows empty state and calls notes.list with correct conversationId
 *   CSN-3: Notes panel shows notes after AI execution creates them
 *   CSN-4: Notes panel refreshes on status change (running → idle)
 */

import { test, expect, openSessionDrawer, openSessionNotesTab } from "./fixtures";
import { makeChatSession, makeChatMessage } from "./fixtures/mock-data";

// ─── CSN-1: Notes tab button visible ──────────────────────────────────────────

test.describe("CSN-1: Notes tab button is visible", () => {
  test("Notes tab button appears in session chat view", async ({ page, api, session }) => {
    api.returns("chatSessions.list", [session]);
    api.returns("chatSessions.get", session);
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    api.returns("notes.list", []);

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    // Notes tab button visible
    const notesTab = page.locator(".scv-tab-btn", { hasText: "Notes" });
    await expect(notesTab).toBeVisible();
  });
});

// ─── CSN-2: Notes panel renders with session conversationId ───────────────────

test.describe("CSN-2: Notes panel renders with session conversationId", () => {
  test("notes.list called with session conversationId when Notes tab is selected", async ({ page, api, session }) => {
    const listCalls: Array<{ conversationId: number }> = [];
    api.handle("notes.list", (params) => {
      listCalls.push(params as { conversationId: number });
      return [];
    });
    api.returns("chatSessions.list", [session]);
    api.returns("chatSessions.get", session);
    api.returns("conversations.getMessages", { messages: [], hasMore: false });

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    // Click Notes tab
    await openSessionNotesTab(page);

    // notes.list called with correct conversationId
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0].conversationId).toBe(session.conversationId);
  });

  test("empty state visible when no notes exist", async ({ page, api, session }) => {
    api.returns("chatSessions.list", [session]);
    api.returns("chatSessions.get", session);
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    api.returns("notes.list", []);

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    // Click Notes tab
    await openSessionNotesTab(page);

    // Empty state visible
    await expect(page.locator(".notes-empty")).toBeVisible();
    await expect(page.locator(".notes-empty")).toContainText("No notes yet");
  });
});

// ─── CSN-3: Notes panel shows notes after AI execution ────────────────────────

test.describe("CSN-3: Notes panel shows notes after AI execution", () => {
  test("note items visible when notes.list returns notes", async ({ page, api, session }) => {
    const notes = [
      { id: 1, conversationId: session.conversationId, content: "First note", isSourceAi: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 2, conversationId: session.conversationId, content: "Second note", isSourceAi: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];
    api.returns("chatSessions.list", [session]);
    api.returns("chatSessions.get", session);
    api.returns("conversations.getMessages", { messages: [], hasMore: false });
    api.returns("notes.list", notes);

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    // Click Notes tab
    await openSessionNotesTab(page);

    // Two note items visible
    const noteItems = page.locator(".note-item");
    await expect(noteItems).toHaveCount(2);
    await expect(noteItems.first()).toContainText("First note");
    await expect(noteItems.last()).toContainText("Second note");
  });
});

// ─── CSN-4: Notes panel refreshes on status change ────────────────────────────

test.describe("CSN-4: Notes panel refreshes on status change (running → idle)", () => {
  test("notes.list re-called when session status changes from running to idle", async ({ page, api, ws, session }) => {
    let listCallCount = 0;
    api.handle("notes.list", () => {
      listCallCount++;
      return [];
    });
    api.returns("chatSessions.list", [session]);
    api.returns("chatSessions.get", session);
    api.returns("conversations.getMessages", { messages: [], hasMore: false });

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    // Click Notes tab
    await openSessionNotesTab(page);

    // Initial load
    const initialCount = listCallCount;
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Simulate session status change from running to idle via WS push
    ws.pushChatSessionUpdated({ ...session, status: "running" });
    await page.waitForTimeout(200);

    ws.pushChatSessionUpdated({ ...session, status: "idle" });
    await page.waitForTimeout(500);

    // Notes list was re-fetched after status change
    expect(listCallCount).toBeGreaterThan(initialCount);
  });
});
