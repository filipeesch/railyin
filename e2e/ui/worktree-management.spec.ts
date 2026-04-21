/**
 * worktree-management.spec.ts — UI tests for the worktree management feature in the Info tab.
 *
 * Suites:
 *   W-A — Display states (7 tests)
 *   W-B — Delete worktree flow (5 tests)
 *   W-C — Create worktree: new branch mode (9 tests)
 *   W-D — Create worktree: existing branch mode (4 tests)
 *   W-E — Error state & retry (4 tests)
 *   W-F — Guard rails: block during running execution (3 tests)
 */

import { test, expect } from "./fixtures";
import { makeTask, makeWorkspace } from "./fixtures/mock-data";
import type { Task } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BRANCHES = ["main", "develop", "feature/x"];

async function openInfoTab(page: import("@playwright/test").Page, taskId: number) {
  await page.locator(`[data-task-id="${taskId}"]`).click();
  await expect(page.locator(".task-detail")).toBeVisible();
  await page.locator(".tab-btn", { hasText: "Info" }).click();
  await expect(page.locator(".task-tab-info")).toBeVisible();
}

function makeReadyTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    worktreeStatus: "ready",
    branchName: "task/1-my-task",
    worktreePath: "/tmp/railyn-test/task-1-my-task",
    ...overrides,
  });
}

// ─── Suite W-A — Display states ───────────────────────────────────────────────

test.describe("W-A — display states", () => {
  test("W-A-1: worktreeStatus null → worktree section not rendered", async ({ page, api }) => {
    const task = makeTask({ worktreeStatus: null });
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info .info-section", { hasText: "Worktree" })).not.toBeVisible();
  });

  test("W-A-2: worktreeStatus ready → branch and path rows visible", async ({ page, api }) => {
    const task = makeReadyTask();
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info .info-value--mono", { hasText: "task/1-my-task" })).toBeVisible();
    await expect(page.locator(".task-tab-info .info-value--mono", { hasText: "/tmp/railyn-test/task-1-my-task" })).toBeVisible();
  });

  test("W-A-3: worktreeStatus ready → delete button visible next to path", async ({ page, api }) => {
    const task = makeReadyTask();
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info button:has(.pi-trash)")).toBeVisible();
  });

  test("W-A-4: worktreeStatus creating → spinner visible, no delete/create controls", async ({ page, api }) => {
    const task = makeTask({ worktreeStatus: "creating" });
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info .pi-spin")).toBeVisible();
    await expect(page.locator(".task-tab-info button:has(.pi-trash)")).not.toBeVisible();
    await expect(page.locator(".task-tab-info .wt-create-form")).not.toBeVisible();
  });

  test("W-A-5: worktreeStatus not_created → create form visible", async ({ page, api }) => {
    const task = makeTask({ worktreeStatus: "not_created" });
    api.returns("tasks.listBranches", { branches: BRANCHES });
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info .wt-create-form")).toBeVisible();
  });

  test("W-A-6: worktreeStatus removed → create form visible", async ({ page, api }) => {
    const task = makeTask({ worktreeStatus: "removed" });
    api.returns("tasks.listBranches", { branches: BRANCHES });
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info .wt-create-form")).toBeVisible();
  });

  test("W-A-7: worktreeStatus error → error indicator + Retry button", async ({ page, api }) => {
    const task = makeTask({ worktreeStatus: "error" });
    api.returns("tasks.listBranches", { branches: BRANCHES });
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info .info-value--danger", { hasText: "error" })).toBeVisible();
    await expect(page.locator(".task-tab-info button", { hasText: "Retry" })).toBeVisible();
  });
});

// ─── Suite W-B — Delete worktree flow ────────────────────────────────────────

test.describe("W-B — delete worktree", () => {
  test("W-B-1: click delete → inline confirmation appears with path text", async ({ page, api }) => {
    const task = makeReadyTask();
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".task-tab-info button:has(.pi-trash)").click();

    await expect(page.locator(".task-tab-info .delete-confirm")).toBeVisible();
    await expect(page.locator(".task-tab-info .delete-confirm__text")).toContainText("/tmp/railyn-test/task-1-my-task");
  });

  test("W-B-2: confirm Cancel → dialog dismissed, removeWorktree NOT called", async ({ page, api }) => {
    const task = makeReadyTask();
    api.handle("tasks.list", () => [task]);
    const removeCalls = api.capture("tasks.removeWorktree", undefined);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".task-tab-info button:has(.pi-trash)").click();
    await expect(page.locator(".task-tab-info .delete-confirm")).toBeVisible();

    await page.locator(".task-tab-info .delete-confirm__actions button", { hasText: "Cancel" }).click();

    await expect(page.locator(".task-tab-info .delete-confirm")).not.toBeVisible();
    expect(removeCalls).toHaveLength(0);
  });

  test("W-B-3: confirm Delete → tasks.removeWorktree called with correct taskId", async ({ page, api }) => {
    const task = makeReadyTask({ id: 42 });
    api.handle("tasks.list", () => [task]);
    const removeCalls = api.capture("tasks.removeWorktree", undefined);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".task-tab-info button:has(.pi-trash)").click();
    await page.locator(".task-tab-info .delete-confirm__actions button", { hasText: "Delete" }).click();

    await expect.poll(() => removeCalls.length).toBe(1);
    expect((removeCalls[0] as { taskId: number }).taskId).toBe(42);
  });

  test("W-B-4: after delete WS push with removed status → create form appears", async ({ page, api, ws }) => {
    const task = makeReadyTask({ id: 10 });
    const removedTask = { ...task, worktreeStatus: "removed" as const, worktreePath: null };
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.removeWorktree", undefined);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".task-tab-info button:has(.pi-trash)").click();
    await page.locator(".task-tab-info .delete-confirm__actions button", { hasText: "Delete" }).click();

    ws.push({ type: "task.updated", payload: removedTask });

    await expect(page.locator(".task-tab-info .wt-create-form")).toBeVisible({ timeout: 5_000 });
  });

  test("W-B-5: removeWorktree returns warning → warning text shown", async ({ page, api }) => {
    const task = makeReadyTask({ id: 11 });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.removeWorktree", { warning: "Some uncommitted changes remain" } as unknown as undefined);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".task-tab-info button:has(.pi-trash)").click();
    await page.locator(".task-tab-info .delete-confirm__actions button", { hasText: "Delete" }).click();

    // warning may be shown via toast or inline — check for the warning text
    await expect(page.locator(".task-tab-info .delete-confirm__warning")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".task-tab-info .delete-confirm__warning")).toContainText("uncommitted");
  });
});

// ─── Suite W-C — Create: new branch mode ─────────────────────────────────────

test.describe("W-C — create: new branch mode", () => {
  test("W-C-1: form opens in New branch mode by default", async ({ page, api }) => {
    const task = makeTask({ id: 20, title: "My Feature", worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".wt-mode-btn--active", { hasText: "New branch" })).toBeVisible();
  });

  test("W-C-2: branch name pre-filled as task/<id>-<slug>", async ({ page, api }) => {
    const task = makeTask({ id: 21, title: "Fix Login Bug", worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    const branchInput = page.locator(".wt-create-form input[placeholder*='task']").first();
    await expect(branchInput).toHaveValue(/task\/21-/);
  });

  test("W-C-3: path pre-filled with exact worktreeBasePath + branch slug", async ({ page, api }) => {
    const task = makeTask({ id: 22, title: "Test Task", worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    const pathInput = page.locator(".wt-create-form input[placeholder*='path']").first();
    // Must be full path: <worktreeBasePath>/<branch-slug>
    await expect(pathInput).toHaveValue("/tmp/railyn-test/task/22-test-task");
  });

  test("W-C-3b: path pre-filled when workspace config loads after component mount", async ({ page, api }) => {
    const task = makeTask({ id: 22, title: "Async Task", worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });
    // Delay workspace config to simulate it arriving after the form renders
    api.delayed("workspace.getConfig", makeWorkspace({ worktreeBasePath: "/tmp/async-base" }), 300);

    await page.goto("/");
    await openInfoTab(page, task.id);

    const pathInput = page.locator(".wt-create-form input[placeholder*='path']").first();
    // Initially empty (no base path yet), then populated once config arrives
    await expect(pathInput).toHaveValue("/tmp/async-base/task/22-async-task", { timeout: 5_000 });
  });

  test("W-C-3c: path empty (but editable) when worktreeBasePath not configured", async ({ page, api }) => {
    const task = makeTask({ id: 22, title: "No Base Task", worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });
    api.returns("workspace.getConfig", makeWorkspace({ worktreeBasePath: "" }));

    await page.goto("/");
    await openInfoTab(page, task.id);

    const pathInput = page.locator(".wt-create-form input[placeholder*='path']").first();
    // Empty — user must fill manually
    await expect(pathInput).toHaveValue("");
    // But Create button is disabled until user fills the path
    await expect(page.locator(".wt-create-form button", { hasText: "Create" })).toBeDisabled();
    // Fill path manually → Create becomes enabled
    await pathInput.fill("/custom/path/my-task");
    await expect(page.locator(".wt-create-form button", { hasText: "Create" })).toBeEnabled();
  });

  test("W-C-4: tasks.listBranches called when form renders", async ({ page, api }) => {
    const task = makeTask({ id: 23, worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    const branchCalls = api.capture("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect.poll(() => branchCalls.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect((branchCalls[0] as { taskId: number }).taskId).toBe(23);
  });

  test("W-C-5: user can edit branch name input", async ({ page, api }) => {
    const task = makeTask({ id: 24, title: "Edit Me", worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    const branchInput = page.locator(".wt-create-form input[placeholder*='task']").first();
    await branchInput.clear();
    await branchInput.fill("my-custom-branch");
    await expect(branchInput).toHaveValue("my-custom-branch");
  });

  test("W-C-6: source branch dropdown shows mocked branch options", async ({ page, api }) => {
    const task = makeTask({ id: 25, worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    // The PrimeVue Select shows options in an overlay on click
    const fromSelect = page.locator(".wt-create-form .wt-field", { hasText: "From" }).locator(".p-select");
    await fromSelect.click();

    await expect(page.locator(".p-select-overlay li", { hasText: "main" })).toBeVisible({ timeout: 3_000 });
    await expect(page.locator(".p-select-overlay li", { hasText: "develop" })).toBeVisible();
    await expect(page.locator(".p-select-overlay li", { hasText: "feature/x" })).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("W-C-7: click Create → tasks.createWorktree called with mode:new and correct params", async ({ page, api }) => {
    const task = makeTask({ id: 26, title: "Feature Work", worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });
    const createCalls = api.capture("tasks.createWorktree", undefined);

    await page.goto("/");
    await openInfoTab(page, task.id);

    // Select source branch
    const fromSelect = page.locator(".wt-create-form .wt-field", { hasText: "From" }).locator(".p-select");
    await fromSelect.click();
    await page.locator(".p-select-overlay li", { hasText: "main" }).click();

    await page.locator(".wt-create-form button", { hasText: "Create Worktree" }).click();

    await expect.poll(() => createCalls.length, { timeout: 5_000 }).toBe(1);
    const call = createCalls[0] as { taskId: number; mode: string; branchName: string; sourceBranch: string; path: string };
    expect(call.taskId).toBe(26);
    expect(call.mode).toBe("new");
    expect(call.branchName).toMatch(/task\/26-/);
    expect(call.sourceBranch).toBe("main");
    expect(call.path).toBeTruthy();
  });

  test("W-C-8: WS push worktreeStatus ready → form collapses, path row appears", async ({ page, api, ws }) => {
    const task = makeTask({ id: 27, title: "Feature", worktreeStatus: "not_created" });
    const readyTask = makeReadyTask({ id: 27, title: "Feature" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });
    api.returns("tasks.createWorktree", undefined);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".wt-create-form button", { hasText: "Create Worktree" }).click();
    ws.push({ type: "task.updated", payload: readyTask });

    await expect(page.locator(".task-tab-info .wt-create-form")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".task-tab-info .info-value--mono", { hasText: "task/1-my-task" })).toBeVisible();
  });

  test("W-C-9: while create is in-flight → Create button shows loading state", async ({ page, api }) => {
    const task = makeTask({ id: 28, worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });
    // Never resolve so we can observe loading state
    api.handle("tasks.createWorktree", () => new Promise(() => {}));

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".wt-create-form button", { hasText: "Create Worktree" }).click();

    await expect(page.locator(".wt-create-form button:has(.p-button-loading-icon)")).toBeVisible({ timeout: 3_000 });
  });
});

// ─── Suite W-D — Create: existing branch mode ────────────────────────────────

test.describe("W-D — create: existing branch mode", () => {
  test("W-D-1: switch to Existing branch → branch dropdown visible, text input gone", async ({ page, api }) => {
    const task = makeTask({ id: 30, worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".wt-mode-btn", { hasText: "Existing branch" }).click();

    await expect(page.locator(".wt-mode-btn--active", { hasText: "Existing branch" })).toBeVisible();
    // Branch text input gone, dropdown present
    await expect(page.locator(".wt-create-form input[placeholder*='task']")).not.toBeVisible();
    await expect(page.locator(".wt-create-form .wt-field", { hasText: "Branch" }).locator(".p-select")).toBeVisible();
  });

  test("W-D-2: existing branch dropdown populated from tasks.listBranches", async ({ page, api }) => {
    const task = makeTask({ id: 31, worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".wt-mode-btn", { hasText: "Existing branch" }).click();

    const branchSelect = page.locator(".wt-create-form .wt-field", { hasText: "Branch" }).locator(".p-select");
    await branchSelect.click();

    await expect(page.locator(".p-select-overlay li", { hasText: "main" })).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press("Escape");
  });

  test("W-D-3: From (source) field hidden in existing branch mode", async ({ page, api }) => {
    const task = makeTask({ id: 32, worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".wt-mode-btn", { hasText: "Existing branch" }).click();

    await expect(page.locator(".wt-create-form .wt-field", { hasText: "From" })).not.toBeVisible();
  });

  test("W-D-4: click Create → tasks.createWorktree called with mode:existing", async ({ page, api }) => {
    const task = makeTask({ id: 33, worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });
    const createCalls = api.capture("tasks.createWorktree", undefined);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".wt-mode-btn", { hasText: "Existing branch" }).click();

    // Select a branch
    const branchSelect = page.locator(".wt-create-form .wt-field", { hasText: "Branch" }).locator(".p-select");
    await branchSelect.click();
    await page.locator(".p-select-overlay li", { hasText: "develop" }).click();

    await page.locator(".wt-create-form button", { hasText: "Create Worktree" }).click();

    await expect.poll(() => createCalls.length, { timeout: 5_000 }).toBe(1);
    const call = createCalls[0] as { taskId: number; mode: string; branchName: string };
    expect(call.mode).toBe("existing");
    expect(call.branchName).toBe("develop");
  });
});

// ─── Suite W-E — Error state & retry ─────────────────────────────────────────

test.describe("W-E — error state and retry", () => {
  test("W-E-1: worktreeStatus error → Retry button present", async ({ page, api }) => {
    const task = makeTask({ id: 40, worktreeStatus: "error" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info button", { hasText: "Retry" })).toBeVisible();
  });

  test("W-E-2: click Retry → create form expands", async ({ page, api }) => {
    const task = makeTask({ id: 41, worktreeStatus: "error" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".task-tab-info button", { hasText: "Retry" }).click();

    await expect(page.locator(".task-tab-info .wt-create-form")).toBeVisible({ timeout: 3_000 });
  });

  test("W-E-3: tasks.createWorktree rejects → error message shown in form", async ({ page, api }) => {
    const task = makeTask({ id: 42, worktreeStatus: "error" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });
    api.handle("tasks.createWorktree", () => { throw new Error("git error: branch already exists"); });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".task-tab-info button", { hasText: "Retry" }).click();
    await page.locator(".wt-create-form button", { hasText: "Create Worktree" }).click();

    await expect(page.locator(".wt-create-form .wt-error")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".wt-create-form .wt-error")).toContainText("branch already exists");
  });

  test("W-E-4: after failed create → Create button re-enabled", async ({ page, api }) => {
    const task = makeTask({ id: 43, worktreeStatus: "error" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });
    api.handle("tasks.createWorktree", () => { throw new Error("failed"); });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await page.locator(".task-tab-info button", { hasText: "Retry" }).click();
    const createBtn = page.locator(".wt-create-form button", { hasText: "Create Worktree" });
    await createBtn.click();

    // After error resolves, button should be enabled again
    await expect(createBtn).toBeEnabled({ timeout: 5_000 });
  });
});

// ─── Suite W-F — Guard rails ──────────────────────────────────────────────────

test.describe("W-F — guard rails during running execution", () => {
  test("W-F-1: executionState running + worktreeStatus ready → delete button disabled", async ({ page, api }) => {
    const task = makeReadyTask({ id: 50, executionState: "running" });
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info button:has(.pi-trash)")).toBeDisabled();
  });

  test("W-F-2: executionState running + worktreeStatus not_created → create form hidden", async ({ page, api }) => {
    const task = makeTask({ id: 51, worktreeStatus: "not_created", executionState: "running" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.listBranches", { branches: BRANCHES });

    await page.goto("/");
    await openInfoTab(page, task.id);

    await expect(page.locator(".task-tab-info .wt-create-form")).not.toBeVisible();
  });

  test("W-F-3: WS update sets executionState idle → delete button becomes enabled", async ({ page, api, ws }) => {
    const runningTask = makeReadyTask({ id: 52, executionState: "running" });
    const idleTask = { ...runningTask, executionState: "idle" as const };
    api.handle("tasks.list", () => [runningTask]);

    await page.goto("/");
    await openInfoTab(page, runningTask.id);

    await expect(page.locator(".task-tab-info button:has(.pi-trash)")).toBeDisabled();

    ws.push({ type: "task.updated", payload: idleTask });

    await expect(page.locator(".task-tab-info button:has(.pi-trash)")).toBeEnabled({ timeout: 5_000 });
  });
});
