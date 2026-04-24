/**
 * chat-sidebar.test.ts — UI regression tests for the Chat Sidebar.
 *
 * Test runner: bun test  (bun:test)
 * Transport:   HTTP bridge to Electrobun debug server (--debug=PORT or /tmp/railyn-debug.port)
 *
 * Run: bun test src/ui-tests/chat-sidebar.test.ts --timeout 120000
 * Requires the app to be running with: bun run dev:test  (--debug=0 --memory-db)
 *
 * Scenarios covered:
 *   Suite CS-A — Sidebar rendering (structure, ordering, status indicators, unread):
 *     CS-A-1: .chat-sidebar is always visible on the board view
 *     CS-A-2: Empty initial state shows no session items
 *     CS-A-3: Sessions appear after seeding, in descending activity order
 *     CS-A-4: Status dot reflects session.status ('idle', 'running', 'waiting_user')
 *     CS-A-5: Unread dot appears when session has unread (lastReadAt < lastActivityAt)
 *     CS-A-6: No unread dot when session is read
 *
 *   Suite CS-B — Session creation & naming:
 *     CS-B-1: "New Chat" button is always visible
 *     CS-B-2: Clicking "New Chat" seeds a new session that appears in the sidebar
 *     CS-B-3: Rename button becomes visible on hover
 *     CS-B-4: Rename interaction: pencil → input → Enter saves new title
 *     CS-B-5: Rename input: pressing Escape cancels without changing title
 *
 *   Suite CS-C — Session archiving:
 *     CS-C-1: Archive button visible on hover
 *     CS-C-2: After archive, session disappears from sidebar
 *     CS-C-3: Archiving last session leaves sidebar empty
 *
 *   Suite CS-D — Live status updates via chatSession.updated push:
 *     CS-D-1: Push status 'running' → status dot updates to status-dot--running
 *     CS-D-2: Push status 'waiting_user' → status dot updates to status-dot--waiting_user
 *     CS-D-3: Push updated lastActivityAt (newer than lastReadAt) → unread dot appears
 *     CS-D-4: Open session after unread push → unread dot clears
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  setupTestEnv,
  navigateToBoardView,
  reloadBoardTasks,
  waitForBoardReady,
  webEval,
  webClick,
  waitFor,
  sleep,
  seedChatSession,
  pushChatSessionUpdated,
  getSessionIds,
  getSessionStatusClass,
  sessionHasUnread,
  openSessionPanel,
  isSessionPanelVisible,
  closeSessionPanel,
} from "./bridge";

// ─── Suite CS-A — Sidebar rendering ──────────────────────────────────────────

describe("Suite CS-A — sidebar rendering", () => {
  beforeAll(async () => {
    await setupTestEnv();
    await navigateToBoardView();
    await reloadBoardTasks();
    await waitForBoardReady(8_000);
  });

  test("CS-A-1: .chat-sidebar is visible on the board view", async () => {
    const visible = await waitFor(".chat-sidebar", 5_000);
    expect(visible).toBe(true);
  });

  test("CS-A-2: empty initial state shows no session items", async () => {
    // Fresh memory DB — no sessions seeded yet in this suite
    const ids = await getSessionIds();
    expect(ids.length).toBe(0);
  });

  test("CS-A-3: seeded sessions appear in descending activity order", async () => {
    const older = await seedChatSession({ title: "Older Chat" });
    await sleep(100);
    const newer = await seedChatSession({ title: "Newer Chat" });
    // Wait for both to appear
    await waitFor(`[data-session-id="${newer.id}"]`, 5_000);

    const ids = await getSessionIds();
    const olderIdx = ids.indexOf(older.id);
    const newerIdx = ids.indexOf(newer.id);
    expect(newerIdx).toBeLessThan(olderIdx); // newer first
  });

  test("CS-A-4: status dot reflects session status", async () => {
    const session = await seedChatSession({ title: "Status Test" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);

    // Default is idle
    const idleClass = await getSessionStatusClass(session.id);
    expect(idleClass).toBe("status-dot--idle");

    // Push running
    await pushChatSessionUpdated({ ...session, status: "running" });
    await sleep(300);
    const runningClass = await getSessionStatusClass(session.id);
    expect(runningClass).toBe("status-dot--running");

    // Push waiting_user
    await pushChatSessionUpdated({ ...session, status: "waiting_user" });
    await sleep(300);
    const waitingClass = await getSessionStatusClass(session.id);
    expect(waitingClass).toBe("status-dot--waiting_user");
  });

  test("CS-A-5: unread dot appears when lastActivityAt > lastReadAt", async () => {
    const session = await seedChatSession({ title: "Unread Test" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);

    // Initially not unread (lastReadAt is null, lastActivityAt is 'now')
    // Push an update with newer lastActivityAt to trigger unread state
    const futureActivity = new Date(Date.now() + 60_000).toISOString();
    await pushChatSessionUpdated({ ...session, lastActivityAt: futureActivity, lastReadAt: null });
    await sleep(300);

    const unread = await sessionHasUnread(session.id);
    expect(unread).toBe(true);
  });

  test("CS-A-6: no unread dot when lastReadAt >= lastActivityAt", async () => {
    const session = await seedChatSession({ title: "Read Test" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);

    const now = new Date().toISOString();
    await pushChatSessionUpdated({ ...session, lastActivityAt: now, lastReadAt: now });
    await sleep(300);

    const unread = await sessionHasUnread(session.id);
    expect(unread).toBe(false);
  });
});

// ─── Suite CS-B — Session creation & naming ───────────────────────────────────

describe("Suite CS-B — session creation & naming", () => {
  beforeAll(async () => {
    await setupTestEnv();
    await navigateToBoardView();
    await reloadBoardTasks();
    await waitForBoardReady(8_000);
  });

  test("CS-B-1: 'New Chat' button is always visible", async () => {
    const visible = await waitFor(".chat-sidebar__new-btn", 5_000);
    expect(visible).toBe(true);
  });

  test("CS-B-2: clicking 'New Chat' creates a session that appears in the sidebar", async () => {
    const beforeIds = await getSessionIds();
    await webClick(".chat-sidebar__new-btn");
    // Wait for a new session to appear
    let afterIds: number[] = [];
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      afterIds = await getSessionIds();
      if (afterIds.length > beforeIds.length) break;
      await sleep(200);
    }
    expect(afterIds.length).toBeGreaterThan(beforeIds.length);
  });

  test("CS-B-3: rename button becomes visible on hover", async () => {
    const session = await seedChatSession({ title: "Rename Me" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);

    // Hover over the session item to reveal actions
    await webEval(`
      var el = document.querySelector('[data-session-id="${session.id}"]');
      if (el) el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    `);
    await sleep(200);

    const btnVisible = await webEval<boolean>(`
      var item = document.querySelector('[data-session-id="${session.id}"]');
      if (!item) return false;
      var btn = item.querySelector('.session-item__action-btn[title="Rename"], .session-item__action-btn .pi-pencil');
      return btn ? getComputedStyle(btn.closest('.session-item__actions') ?? btn).display !== 'none' : false;
    `);
    expect(btnVisible).toBe(true);
  });

  test("CS-B-4: rename via pencil → input → Enter saves new title", async () => {
    const session = await seedChatSession({ title: "Original Title" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);

    // Hover to reveal rename button
    await webEval(`
      var el = document.querySelector('[data-session-id="${session.id}"]');
      if (el) el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    `);
    await sleep(200);

    // Click the first action button (rename)
    await webEval(`
      var item = document.querySelector('[data-session-id="${session.id}"]');
      var btn = item?.querySelector('.session-item__action-btn');
      if (btn) btn.click();
    `);
    await sleep(200);

    // An input should now be visible inside the item
    const inputVisible = await waitFor(`[data-session-id="${session.id}"] .session-item__rename-input`, 3_000);
    expect(inputVisible).toBe(true);

    // Clear and type new title + Enter
    await webEval(`
      var input = document.querySelector('[data-session-id="${session.id}"] .session-item__rename-input');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = 'Renamed Title';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    `);
    await sleep(500);

    // Title should update
    const updatedTitle = await webEval<string>(`
      var el = document.querySelector('[data-session-id="${session.id}"] .session-item__title');
      return el ? el.textContent?.trim() ?? '' : '';
    `);
    expect(updatedTitle).toBe("Renamed Title");
  });

  test("CS-B-5: pressing Escape during rename cancels without changing title", async () => {
    const session = await seedChatSession({ title: "Escape Test" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);

    // Hover + click rename
    await webEval(`
      var el = document.querySelector('[data-session-id="${session.id}"]');
      if (el) el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    `);
    await sleep(200);
    await webEval(`
      var item = document.querySelector('[data-session-id="${session.id}"]');
      var btn = item?.querySelector('.session-item__action-btn');
      if (btn) btn.click();
    `);
    await sleep(200);

    await waitFor(`[data-session-id="${session.id}"] .session-item__rename-input`, 3_000);

    // Press Escape
    await webEval(`
      var input = document.querySelector('[data-session-id="${session.id}"] .session-item__rename-input');
      if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    `);
    await sleep(300);

    // Title unchanged, no input visible
    const titleEl = await webEval<string>(`
      var el = document.querySelector('[data-session-id="${session.id}"] .session-item__title');
      return el ? el.textContent?.trim() ?? '' : '';
    `);
    expect(titleEl).toBe("Escape Test");

    const inputGone = await webEval<boolean>(`
      return !document.querySelector('[data-session-id="${session.id}"] .session-item__rename-input');
    `);
    expect(inputGone).toBe(true);
  });
});

// ─── Suite CS-C — Session archiving ───────────────────────────────────────────

describe("Suite CS-C — session archiving", () => {
  beforeAll(async () => {
    await setupTestEnv();
    await navigateToBoardView();
    await reloadBoardTasks();
    await waitForBoardReady(8_000);
  });

  test("CS-C-1: archive button visible on hover", async () => {
    const session = await seedChatSession({ title: "Archive Me" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);

    await webEval(`
      var el = document.querySelector('[data-session-id="${session.id}"]');
      if (el) el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    `);
    await sleep(200);

    const hasActions = await webEval<boolean>(`
      var item = document.querySelector('[data-session-id="${session.id}"]');
      return !!item?.querySelector('.session-item__actions');
    `);
    expect(hasActions).toBe(true);
  });

  test("CS-C-2: after archive, session disappears from sidebar", async () => {
    const session = await seedChatSession({ title: "To Archive" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);

    // Hover to reveal actions
    await webEval(`
      var el = document.querySelector('[data-session-id="${session.id}"]');
      if (el) el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    `);
    await sleep(200);

    // Click the second action button (archive)
    await webEval(`
      var item = document.querySelector('[data-session-id="${session.id}"]');
      var btns = item?.querySelectorAll('.session-item__action-btn');
      if (btns && btns.length > 1) btns[btns.length - 1].click();
    `);

    // Wait for session to disappear
    const deadline = Date.now() + 5_000;
    let gone = false;
    while (Date.now() < deadline) {
      const present = await webEval<boolean>(`return !!document.querySelector('[data-session-id="${session.id}"]')`);
      if (!present) { gone = true; break; }
      await sleep(200);
    }
    expect(gone).toBe(true);
  });

  test("CS-C-3: archiving last session leaves sidebar empty", async () => {
    // Archive all existing sessions first by reloading with a fresh DB via setupTestEnv
    await setupTestEnv();
    await navigateToBoardView();
    await waitForBoardReady(5_000);

    const session = await seedChatSession({ title: "Last Session" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);

    await webEval(`
      var el = document.querySelector('[data-session-id="${session.id}"]');
      if (el) el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    `);
    await sleep(200);
    await webEval(`
      var item = document.querySelector('[data-session-id="${session.id}"]');
      var btns = item?.querySelectorAll('.session-item__action-btn');
      if (btns && btns.length > 1) btns[btns.length - 1].click();
    `);

    const deadline = Date.now() + 5_000;
    let empty = false;
    while (Date.now() < deadline) {
      const ids = await getSessionIds();
      if (ids.length === 0) { empty = true; break; }
      await sleep(200);
    }
    expect(empty).toBe(true);
  });
});

// ─── Suite CS-D — Live status updates via chatSession.updated push ────────────

describe("Suite CS-D — live status updates via WS push", () => {
  let session: Awaited<ReturnType<typeof seedChatSession>>;

  beforeAll(async () => {
    await setupTestEnv();
    await navigateToBoardView();
    await reloadBoardTasks();
    await waitForBoardReady(8_000);
    session = await seedChatSession({ title: "Live Update Test" });
    await waitFor(`[data-session-id="${session.id}"]`, 5_000);
  });

  test("CS-D-1: push status 'running' → status-dot--running", async () => {
    await pushChatSessionUpdated({ ...session, status: "running" });
    let found = false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const cls = await getSessionStatusClass(session.id);
      if (cls === "status-dot--running") { found = true; break; }
      await sleep(100);
    }
    expect(found).toBe(true);
  });

  test("CS-D-2: push status 'waiting_user' → status-dot--waiting_user", async () => {
    await pushChatSessionUpdated({ ...session, status: "waiting_user" });
    let found = false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const cls = await getSessionStatusClass(session.id);
      if (cls === "status-dot--waiting_user") { found = true; break; }
      await sleep(100);
    }
    expect(found).toBe(true);
  });

  test("CS-D-3: push newer lastActivityAt with null lastReadAt → unread dot", async () => {
    const futureActivity = new Date(Date.now() + 120_000).toISOString();
    await pushChatSessionUpdated({ ...session, status: "idle", lastActivityAt: futureActivity, lastReadAt: null });
    let unread = false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      unread = await sessionHasUnread(session.id);
      if (unread) break;
      await sleep(100);
    }
    expect(unread).toBe(true);
  });

  test("CS-D-4: opening session clears unread dot", async () => {
    // Session should have unread dot from CS-D-3
    const wasUnread = await sessionHasUnread(session.id);
    expect(wasUnread).toBe(true);

    await openSessionPanel(session.id);
    await sleep(500); // allow markRead to propagate

    const stillUnread = await sessionHasUnread(session.id);
    expect(stillUnread).toBe(false);

    // Clean up
    try { await closeSessionPanel(); } catch { /* ignore */ }
  });
});
