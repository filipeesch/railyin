/**
 * compact-button.spec.ts — UI tests for the Compact button visibility guard.
 *
 * Verifies that the Compact button in the context popover is only shown when
 * the conversation model is present in availableModels with supportsManualCompact=true.
 *
 * Scenarios:
 *   MP-F-1: Task model absent from listEnabled (null ctxWindow filtered) → hidden
 *   MP-F-2: Task model present with supportsManualCompact=true → visible
 *   MP-F-3: task.model is null → hidden regardless of availableModels
 *
 * Backend: fully mocked via ApiMock.
 */

import { test, expect } from "./fixtures";
import type { ApiMock } from "./fixtures/mock-api";
import { makeTask } from "./fixtures/mock-data";
import { openTaskDrawer } from "./fixtures/helpers";

const QWEN_MODEL_ID = "pi-local/lmstudio/qwen3:8b";

// ─── MP-F-1: Compact button hidden when task model filtered out of listEnabled ──

test.describe("MP-F-1: compact button hidden when task model filtered out", () => {
  test("task with model absent from listEnabled shows no compact button", async ({ page, api, task }) => {
    // Seed a task with a model that won't be in listEnabled (null contextWindow → filtered)
    const taskWithModel = makeTask({ id: 1, model: QWEN_MODEL_ID });
    api.handle("tasks.list", () => [taskWithModel]);
    // listEnabled excludes this model (contextWindow: null → filtered by handler)
    api.handle("models.listEnabled", () => [
      { id: "fake/test", displayName: "Fake/Test", contextWindow: 8192 },
    ]);

    await page.goto("/");
    await openTaskDrawer(page, taskWithModel.id);

    // Ring button opens the context popover
    const ringBtn = page.locator("button.context-ring-btn");
    await expect(ringBtn).toBeVisible({ timeout: 3_000 });
    await ringBtn.click();

    // Compact action should NOT be visible
    await expect(page.locator(".ctx-popover button:has-text('Compact')")).not.toBeVisible();
  });
});

// ─── MP-F-2: Compact button visible when task model is in availableModels ───────

test.describe("MP-F-2: compact button visible when task model is available", () => {
  test("task with model in listEnabled with supportsManualCompact=true shows compact button", async ({ page, api, task }) => {
    const taskWithModel = makeTask({ id: 1, model: QWEN_MODEL_ID });
    api.handle("tasks.list", () => [taskWithModel]);
    // listEnabled INCLUDES the task's model with supportsManualCompact
    api.handle("models.listEnabled", () => [
      { id: QWEN_MODEL_ID, displayName: "Qwen3 8B", contextWindow: 32768, supportsManualCompact: true },
    ]);

    await page.goto("/");
    await openTaskDrawer(page, taskWithModel.id);

    const ringBtn = page.locator("button.context-ring-btn");
    await expect(ringBtn).toBeVisible({ timeout: 3_000 });
    await ringBtn.click();

    // Compact action IS visible
    await expect(page.locator(".ctx-popover button:has-text('Compact')")).toBeVisible();
  });
});

// ─── MP-F-3: Compact button hidden when task.model is null ──────────────────────

test.describe("MP-F-3: compact button hidden when task.model is null", () => {
  test("task with null model shows no compact button even if availableModels supports compact", async ({ page, api, task }) => {
    // task.model is null (default)
    const taskWithoutModel = makeTask({ id: 1, model: null });
    api.handle("tasks.list", () => [taskWithoutModel]);
    // availableModels includes a model with supportsManualCompact
    api.handle("models.listEnabled", () => [
      { id: QWEN_MODEL_ID, displayName: "Qwen3 8B", contextWindow: 32768, supportsManualCompact: true },
    ]);

    await page.goto("/");
    await openTaskDrawer(page, taskWithoutModel.id);

    const ringBtn = page.locator("button.context-ring-btn");
    await expect(ringBtn).toBeVisible({ timeout: 3_000 });
    await ringBtn.click();

    // Compact action should NOT be visible — task.model is null
    await expect(page.locator(".ctx-popover button:has-text('Compact')")).not.toBeVisible();
  });
});
