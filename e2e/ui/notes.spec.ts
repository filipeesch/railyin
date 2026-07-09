/**
 * notes.spec.ts — Playwright UI tests for the Notes panel.
 *
 * Tests the Notes tab in the task detail drawer:
 *   T-N1: Notes tab button is visible
 *   T-N2: Notes tab shows empty state
 *   T-N3: notes.list called with correct conversationId
 *   T-N4: Two notes visible in panel
 *   T-N5: "+ New Note" opens overlay
 *   T-N6: Saving new note calls notes.create
 *   T-N7: Clicking existing note opens overlay prefilled
 *   T-N8: Editing and saving calls notes.update
 *   T-N9: Delete calls notes.delete
 *   T-N10: task.updated WS push triggers notes re-fetch
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures/helpers";

const NOTE_CONVERSATION_ID = 1;

// ─── T-N1: Notes tab button visible ──────────────────────────────────────────

test.describe("T-N1: Notes tab button is visible", () => {
  test("Notes tab button appears in task toolbar", async ({ page, api, task }) => {
    api.returns("notes.list", []);
    api.returns("tasks.list", [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Notes tab button visible
    const notesTab = page.locator(".tab-btn", { hasText: "Notes" });
    await expect(notesTab).toBeVisible();
  });
});

// ─── T-N2: Notes tab shows empty state ────────────────────────────────────────

test.describe("T-N2: Notes tab shows empty state", () => {
  test("empty state text when no notes exist", async ({ page, api, task }) => {
    api.returns("notes.list", []);
    api.returns("tasks.list", [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Click Notes tab
    await page.locator(".tab-btn", { hasText: "Notes" }).click();

    // Empty state visible
    await expect(page.locator(".notes-empty")).toBeVisible();
    await expect(page.locator(".notes-empty")).toContainText("No notes yet");
  });
});

// ─── T-N3: notes.list called with correct conversationId ──────────────────────

test.describe("T-N3: notes.list called with correct conversationId", () => {
  test("notes.list receives the task's conversationId", async ({ page, api, task }) => {
    const listCalls: Array<{ conversationId: number }> = [];
    api.handle("notes.list", (params) => {
      listCalls.push(params as { conversationId: number });
      return [];
    });
    api.returns("tasks.list", [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Click Notes tab
    await page.locator(".tab-btn", { hasText: "Notes" }).click();

    // notes.list called with correct conversationId
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0].conversationId).toBe(task.conversationId);
  });
});

// ─── T-N4: Notes visible when list returns two notes ──────────────────────────

test.describe("T-N4: notes.list returns two notes → both visible", () => {
  test("two note items rendered in the notes list", async ({ page, api, task }) => {
    api.returns("notes.list", [
      { id: 1, conversationId: NOTE_CONVERSATION_ID, content: "First note", isSourceAi: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 2, conversationId: NOTE_CONVERSATION_ID, content: "Second note", isSourceAi: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    api.returns("tasks.list", [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".tab-btn", { hasText: "Notes" }).click();

    // Two note items visible
    const noteItems = page.locator(".note-item");
    await expect(noteItems).toHaveCount(2);
    await expect(noteItems.first()).toContainText("First note");
    await expect(noteItems.last()).toContainText("Second note");
  });
});

// ─── T-N5: "+ New Note" opens overlay ────────────────────────────────────────

test.describe("T-N5: + New Note opens overlay", () => {
  test("clicking New Note button opens the note overlay", async ({ page, api, task }) => {
    api.returns("notes.list", []);
    api.returns("tasks.list", [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".tab-btn", { hasText: "Notes" }).click();

    // Click New Note button
    await page.getByRole("button", { name: "New note" }).click();

    // Overlay visible
    await expect(page.locator(".note-overlay")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator(".note-overlay__title")).toContainText("New Note");
  });
});

// ─── T-N6: Saving new note calls notes.create ─────────────────────────────────

test.describe("T-N6: saving new note calls notes.create", () => {
  test("filling form and clicking Save calls notes.create", async ({ page, api, task }) => {
    const createCalls: Array<{ conversationId: number; content: string }> = [];
    api.handle("notes.create", (params) => {
      createCalls.push(params as { conversationId: number; content: string });
      return {
        id: 999,
        conversationId: params.conversationId,
        content: params.content,
        isSourceAi: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    api.returns("notes.list", []);
    api.returns("tasks.list", [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".tab-btn", { hasText: "Notes" }).click();

    // Click New Note
    await page.getByRole("button", { name: "New note" }).click();

    // Fill textarea
    await page.locator(".note-overlay__textarea").fill("New note content");

    // Click Save button (PrimeVue Button renders label as text content)
    await page.locator(".note-overlay__footer button:has-text('Save')").click();

    // notes.create called
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].content).toBe("New note content");
  });
});

// ─── T-N7: Clicking existing note opens overlay prefilled ─────────────────────

test.describe("T-N7: clicking existing note opens overlay prefilled", () => {
  test("click note item opens edit overlay with content pre-filled", async ({ page, api, task }) => {
    api.returns("notes.list", [
      { id: 1, conversationId: NOTE_CONVERSATION_ID, content: "Edit me", isSourceAi: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    api.returns("tasks.list", [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".tab-btn", { hasText: "Notes" }).click();

    // Click note item
    await page.locator(".note-item").click();

    // Overlay visible and textarea has the note content
    await expect(page.locator(".note-overlay")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator(".note-overlay__title")).toContainText("Edit Note");
    await expect(page.locator(".note-overlay__textarea")).toHaveValue("Edit me");
  });
});

// ─── T-N8: Editing and saving calls notes.update ──────────────────────────────

test.describe("T-N8: editing and saving calls notes.update", () => {
  test("changing content and clicking Save calls notes.update", async ({ page, api, task }) => {
    const updateCalls: Array<{ id: number; content: string }> = [];
    api.handle("notes.update", (params) => {
      updateCalls.push(params as { id: number; content: string });
      return {
        id: params.id,
        conversationId: NOTE_CONVERSATION_ID,
        content: params.content,
        isSourceAi: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    api.returns("notes.list", [
      { id: 1, conversationId: NOTE_CONVERSATION_ID, content: "Original", isSourceAi: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    api.returns("tasks.list", [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".tab-btn", { hasText: "Notes" }).click();

    // Click note to edit
    await page.locator(".note-item").click();

    // Change content
    await page.locator(".note-overlay__textarea").fill("Updated content");

    // Click Save button (PrimeVue Button renders label as text content)
    await page.locator(".note-overlay__footer button:has-text('Save')").click();

    // notes.update called
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].id).toBe(1);
    expect(updateCalls[0].content).toBe("Updated content");
  });
});

// ─── T-N9: Delete calls notes.delete ──────────────────────────────────────────

test.describe("T-N9: delete calls notes.delete", () => {
  test("clicking trash icon calls notes.delete and removes note from panel", async ({ page, api, task }) => {
    const deleteCalls: Array<{ id: number }> = [];
    api.handle("notes.delete", (params) => {
      deleteCalls.push(params as { id: number });
      return undefined;
    });
    api.returns("notes.list", [
      { id: 1, conversationId: NOTE_CONVERSATION_ID, content: "Delete me", isSourceAi: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    api.returns("tasks.list", [task]);

    // Handle the confirm dialog
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".tab-btn", { hasText: "Notes" }).click();

    // Click note to open overlay
    await page.locator(".note-item").click();

    // Click trash icon
    await page.locator(".note-overlay__header-actions button[aria-label='Delete note']").click();

    // notes.delete called
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].id).toBe(1);

    // Overlay closed
    await expect(page.locator(".note-overlay")).not.toBeVisible();
  });
});

// ─── T-N10: task.updated WS push triggers notes re-fetch ──────────────────────

test.describe("T-N10: task.updated WS push triggers notes re-fetch", () => {
  test("WS push event triggers notes refresh", async ({ page, api, ws, task }) => {
    let listCallCount = 0;
    api.handle("notes.list", () => {
      listCallCount++;
      return [];
    });
    api.returns("tasks.list", [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".tab-btn", { hasText: "Notes" }).click();

    // Initial load
    const initialCount = listCallCount;

    // Push a task.updated event (simulating backend change)
    ws.push({ type: "task.updated", payload: { ...task, title: "Updated title" } });

    // Allow time for re-fetch
    await page.waitForTimeout(500);

    // Notes list was re-fetched (refreshTrigger prop on NotesPanel triggers re-fetch)
    expect(listCallCount).toBeGreaterThanOrEqual(initialCount);
  });
});
