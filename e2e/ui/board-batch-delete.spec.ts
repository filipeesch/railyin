/**
 * board-batch-delete.spec.ts — Batch card deletion UI tests.
 */

import { test, expect } from "./fixtures";
import { makeTask, makeBoard, makeWorkspace } from "./fixtures/mock-data";
import { navigateToBoard } from "./fixtures/board-helpers";

const SELECT_DELETE_BTN = "button[aria-label='Select cards to delete']";
const DELETE_N_BTN = "button:has-text('Delete')";
const CANCEL_BTN = "button:has-text('Cancel')";

async function enterSelectionMode(page: import("@playwright/test").Page) {
  await page.locator(SELECT_DELETE_BTN).click();
  await expect(page.locator(CANCEL_BTN)).toBeVisible();
}

test.describe("BDEL — batch delete cards", () => {
  test("BDEL-1: clicking topbar trash enters selection mode and shows checkboxes", async ({ page, api }) => {
    const task = makeTask({ id: 1 });
    api.handle("tasks.list", () => [task]);

    await navigateToBoard(page);
    await enterSelectionMode(page);

    const checkbox = page.locator("[data-task-id='1'] .task-card__checkbox");
    await expect(checkbox).toBeVisible();
  });

  test("BDEL-2: clicking a card in selection mode toggles its checkbox", async ({ page, api }) => {
    const task = makeTask({ id: 1 });
    api.handle("tasks.list", () => [task]);

    await navigateToBoard(page);
    await enterSelectionMode(page);

    const card = page.locator("[data-task-id='1']");
    await card.click();
    await expect(card).toHaveClass(/is-selected/);

    await card.click();
    await expect(card).not.toHaveClass(/is-selected/);
  });

  test("BDEL-3: Delete N button shows selected count", async ({ page, api }) => {
    const task1 = makeTask({ id: 1 });
    const task2 = makeTask({ id: 2 });
    api.handle("tasks.list", () => [task1, task2]);

    await navigateToBoard(page);
    await enterSelectionMode(page);

    await page.locator("[data-task-id='1']").click();
    await page.locator("[data-task-id='2']").click();

    await expect(page.locator("button:has-text('Delete 2')")).toBeVisible();
  });

  test("BDEL-4: Delete N is disabled when no cards are selected", async ({ page, api }) => {
    const task = makeTask({ id: 1 });
    api.handle("tasks.list", () => [task]);

    await navigateToBoard(page);
    await enterSelectionMode(page);

    const deleteBtn = page.locator("button:has-text('Delete 0')");
    await expect(deleteBtn).toBeDisabled();
  });

  test("BDEL-5: cancel exits selection mode", async ({ page, api }) => {
    const task = makeTask({ id: 1 });
    api.handle("tasks.list", () => [task]);

    await navigateToBoard(page);
    await enterSelectionMode(page);
    await page.locator(CANCEL_BTN).click();

    await expect(page.locator(SELECT_DELETE_BTN)).toBeVisible();
    await expect(page.locator("[data-task-id='1'] .task-card__checkbox")).not.toBeVisible();
  });

  test("BDEL-6: confirming dialog deletes selected cards via tasks.delete", async ({ page, api }) => {
    const task1 = makeTask({ id: 1 });
    const task2 = makeTask({ id: 2 });
    const task3 = makeTask({ id: 3 });
    api.handle("tasks.list", () => [task1, task2, task3]);

    const deleteCalls: { taskId: number }[] = [];
    api.handle("tasks.delete", (params) => {
      deleteCalls.push(params as { taskId: number });
      return {};
    });

    await navigateToBoard(page);
    await enterSelectionMode(page);

    await page.locator("[data-task-id='1']").click();
    await page.locator("[data-task-id='3']").click();

    await page.locator("button:has-text('Delete 2')").click();
    await expect(page.locator("text=Are you sure you want to delete 2 selected cards?")).toBeVisible();

    const dialog = page.locator(".p-dialog");
    await dialog.locator("button:has-text('Delete')").click();

    await expect.poll(() => deleteCalls.map((c) => c.taskId).sort((a, b) => a - b)).toEqual([1, 3]);
    const deletedIds = deleteCalls.map((c) => c.taskId).sort((a, b) => a - b);
    await expect(page.locator("[data-task-id='1']")).not.toBeVisible();
    await expect(page.locator("[data-task-id='3']")).not.toBeVisible();
    await expect(page.locator("[data-task-id='2']")).toBeVisible();
  });

  test("BDEL-7: cancelling dialog keeps selection mode active", async ({ page, api }) => {
    const task = makeTask({ id: 1 });
    api.handle("tasks.list", () => [task]);

    await navigateToBoard(page);
    await enterSelectionMode(page);
    await page.locator("[data-task-id='1']").click();

    await page.locator("button:has-text('Delete 1')").click();
    await expect(page.locator("text=Are you sure you want to delete 1 selected card?")).toBeVisible();

    const dialog = page.locator(".p-dialog");
    await dialog.locator("button:has-text('Cancel')").click();

    await expect(page.locator("[data-task-id='1']")).toHaveClass(/is-selected/);
    await expect(page.locator("button:has-text('Delete 1')")).toBeVisible();
  });

  test("BDEL-8: selection resets when switching board", async ({ page, api }) => {
    const task = makeTask({ id: 1 });
    const board2 = makeBoard({ id: 2, name: "Board 2" });
    api
      .handle("tasks.list", () => [task])
      .returns("boards.list", [makeBoard(), board2]);

    await navigateToBoard(page);
    await enterSelectionMode(page);
    await page.locator("[data-task-id='1']").click();

    await page.locator(".board-selector").click();
    await page.locator("text=Board 2").click();

    await expect(page.locator(SELECT_DELETE_BTN)).toBeVisible();
  });

  test("BDEL-9: selection resets when switching workspace", async ({ page, api }) => {
    const task = makeTask({ id: 1 });
    api
      .handle("tasks.list", () => [task])
      .returns("workspace.list", [
        { key: "test-workspace", name: "Test Workspace" },
        { key: "other-workspace", name: "Other Workspace" },
      ])
      .returns("workspace.getConfig", makeWorkspace({ key: "other-workspace", name: "Other Workspace" }));

    await navigateToBoard(page);
    await enterSelectionMode(page);
    await page.locator("[data-task-id='1']").click();

    await page.locator("button:has-text('Other Workspace')").click();

    await expect(page.locator(SELECT_DELETE_BTN)).toBeVisible();
  });
});
