/**
 * code-server.spec.ts — UI tests for the code-server integration.
 *
 * Suites:
 *   CS-A — toolbar button visibility
 *   CS-B — overlay lifecycle (open / loading / ready / close / stop)
 *   CS-C — z-index: overlay sits behind the chat drawer
 *   CS-D — CodeRef chips (receive via WS, dismiss, send with refs)
 */

import { test, expect } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { Task, CodeRef } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTaskWithWorktree(overrides: Partial<Task> = {}): Task {
  return makeTask({
    worktreeStatus: "ready",
    worktreePath: "/tmp/worktrees/task-1",
    ...overrides,
  });
}

function makeCodeRef(overrides: Partial<CodeRef> = {}): CodeRef {
  return {
    taskId: 1,
    file: "/tmp/worktrees/task-1/src/utils.ts",
    startLine: 10,
    startChar: 0,
    endLine: 15,
    endChar: 5,
    text: "export function foo() {\n  return 42;\n}",
    language: "typescript",
    ...overrides,
  };
}

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
  await page.locator(`[data-task-id="${taskId}"]`).click();
  await expect(page.locator(".task-detail")).toBeVisible();
}

// ─── Suite CS-A — toolbar button visibility ───────────────────────────────────

test.describe("CS-A — toolbar button: visibility based on worktreePath", () => {
  test("CS-A-1: code editor button visible when task has worktreePath", async ({ page, api }) => {
    const task = makeTaskWithWorktree();
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const codeBtn = page.locator(".task-detail button:has(.pi-code)");
    await expect(codeBtn).toBeVisible({ timeout: 5_000 });
  });

  test("CS-A-2: code editor button NOT visible when task has no worktreePath", async ({ page, api }) => {
    const task = makeTaskWithWorktree({ worktreePath: null });
    api.handle("tasks.list", () => [task]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Wait for drawer to fully render
    await expect(page.locator(".task-detail")).toBeVisible();
    await page.waitForTimeout(500);

    const codeBtn = page.locator(".task-detail button:has(.pi-code)");
    await expect(codeBtn).not.toBeVisible();
  });

  test("CS-A-3: code editor button appears when worktree is created while drawer is open", async ({ page, api, ws }) => {
    const task = makeTask({ worktreeStatus: "not_created" });
    api.handle("tasks.list", () => [task]);
    api.returns("tasks.createWorktree", undefined);
    api.returns("tasks.listBranches", { branches: ["main"] });

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Verify buttons are hidden initially
    await expect(page.locator(".task-detail button:has(.pi-code)")).not.toBeVisible();
    await expect(page.locator(".task-detail button:has(.pi-desktop)")).not.toBeVisible();

    // Switch to Info tab and create worktree
    await page.locator(".tab-btn", { hasText: "Info" }).click();
    await expect(page.locator(".task-tab-info")).toBeVisible();
    await page.locator(".wt-create-form button", { hasText: "Create Worktree" }).click();

    // Wait for worktree creation to complete by pushing a task update via WS
    ws.push({ type: "task.updated", payload: makeTaskWithWorktree({ id: task.id }) });

    // Verify buttons now appear
    await expect(page.locator(".task-detail button:has(.pi-code)")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".task-detail button:has(.pi-desktop)")).toBeVisible();
  });
});

// ─── Suite CS-B — overlay lifecycle ──────────────────────────────────────────

test.describe("CS-B — overlay lifecycle", () => {
  test("CS-B-1: clicking code editor button triggers codeServer.start RPC call", async ({ page, api }) => {
    const task = makeTaskWithWorktree();
    api.handle("tasks.list", () => [task]);

    let startCalled = false;
    api.handle("codeServer.start", () => {
      startCalled = true;
      // Simulate a long-running start so we can observe the loading state
      return new Promise(() => { }); // never resolves — stays in loading
    });

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const codeBtn = page.locator(".task-detail button:has(.pi-code)");
    await expect(codeBtn).toBeVisible({ timeout: 5_000 });
    await codeBtn.click();

    // Overlay should appear
    await expect(page.locator(".code-server-overlay")).toBeVisible({ timeout: 5_000 });

    expect(startCalled).toBe(true);
  });

  test("CS-B-2: overlay shows loading spinner while status is 'starting'", async ({ page, api }) => {
    const task = makeTaskWithWorktree();
    api.handle("tasks.list", () => [task]);
    // Never resolves — keeps status as 'starting'
    api.handle("codeServer.start", () => new Promise(() => { }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".task-detail button:has(.pi-code)").click();

    await expect(page.locator(".code-server-overlay")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".code-server-overlay__loading")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator(".code-server-overlay__iframe")).not.toBeVisible();
  });

  test("CS-B-3: overlay shows iframe when codeServer.start returns a port", async ({ page, api }) => {
    const task = makeTaskWithWorktree();
    api.handle("tasks.list", () => [task]);
    api.handle("codeServer.start", () => ({ port: 3100 }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".task-detail button:has(.pi-code)").click();

    await expect(page.locator(".code-server-overlay")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".code-server-overlay__iframe")).toBeVisible({ timeout: 5_000 });
    const src = await page.locator(".code-server-overlay__iframe").getAttribute("src");
    expect(src).toBe("http://127.0.0.1:3100");
  });

  test("CS-B-4: close (×) button hides the overlay", async ({ page, api }) => {
    const task = makeTaskWithWorktree();
    api.handle("tasks.list", () => [task]);
    api.handle("codeServer.start", () => ({ port: 3100 }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".task-detail button:has(.pi-code)").click();
    await expect(page.locator(".code-server-overlay")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".code-server-overlay__iframe")).toBeVisible({ timeout: 5_000 });

    // Close the drawer so it doesn't intercept overlay clicks
    await page.keyboard.press("Escape");
    await expect(page.locator(".p-drawer-mask")).not.toBeVisible({ timeout: 3_000 });

    // Click the × close button
    const closeBtn = page.locator(".code-server-overlay__actions button:has(.pi-times)");
    await expect(closeBtn).toBeVisible({ timeout: 3_000 });
    await closeBtn.click();

    await expect(page.locator(".code-server-overlay")).not.toBeVisible({ timeout: 3_000 });
  });

  test("CS-B-5: stop button calls codeServer.stop and hides overlay", async ({ page, api }) => {
    const task = makeTaskWithWorktree();
    api.handle("tasks.list", () => [task]);
    api.handle("codeServer.start", () => ({ port: 3100 }));

    let stopCalled = false;
    api.handle("codeServer.stop", () => {
      stopCalled = true;
      return { ok: true };
    });

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".task-detail button:has(.pi-code)").click();
    await expect(page.locator(".code-server-overlay__iframe")).toBeVisible({ timeout: 5_000 });

    // Close the drawer so it doesn't intercept overlay clicks
    await page.keyboard.press("Escape");
    await expect(page.locator(".p-drawer-mask")).not.toBeVisible({ timeout: 3_000 });

    // Click the stop (pi-stop-circle) button
    const stopBtn = page.locator(".code-server-overlay__actions button:has(.pi-stop-circle)");
    await expect(stopBtn).toBeVisible({ timeout: 3_000 });
    await stopBtn.click();

    await expect(page.locator(".code-server-overlay")).not.toBeVisible({ timeout: 3_000 });
    expect(stopCalled).toBe(true);
  });

  test("CS-B-6: overlay shows task title in header", async ({ page, api }) => {
    const task = makeTaskWithWorktree({ title: "Task 1" });
    api.handle("tasks.list", () => [task]);
    api.handle("codeServer.start", () => ({ port: 3100 }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".task-detail button:has(.pi-code)").click();
    await expect(page.locator(".code-server-overlay")).toBeVisible({ timeout: 5_000 });

    await expect(page.locator(".code-server-overlay__title")).toContainText("Task 1");
  });
});

// ─── Suite CS-C — z-index: overlay behind the drawer ─────────────────────────

test.describe("CS-C — z-index: overlay sits below the chat drawer", () => {
  test("CS-C-1: overlay z-index is 800, lower than the task drawer", async ({ page, api }) => {
    const task = makeTaskWithWorktree();
    api.handle("tasks.list", () => [task]);
    api.handle("codeServer.start", () => ({ port: 3100 }));

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    await page.locator(".task-detail button:has(.pi-code)").click();
    await expect(page.locator(".code-server-overlay")).toBeVisible({ timeout: 5_000 });

    const overlayZIndex = await page.locator(".code-server-overlay").evaluate((el) => {
      return parseInt(getComputedStyle(el).zIndex, 10);
    });
    expect(overlayZIndex).toBe(800);

    // Drawer should be visible on top of the overlay
    await expect(page.locator(".task-detail")).toBeVisible();
  });
});

// ─── Suite CS-D — CodeRef chips ───────────────────────────────────────────────

test.describe("CS-D — CodeRef chips in chat input", () => {
  test("CS-D-1: CodeRef chip appears in input area after code.ref WS push", async ({ page, api, ws, task }) => {
    const readyTask = makeTaskWithWorktree({ id: task.id });
    api.handle("tasks.list", () => [readyTask]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    const ref = makeCodeRef({ taskId: task.id });
    ws.push({ type: "code.ref", payload: ref });

    await expect(page.locator(".code-ref-chip")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".code-ref-chip__label")).toContainText("utils.ts");
    await expect(page.locator(".code-ref-chip__label")).toContainText("L10");
  });

  test("CS-D-2: dismiss button removes the CodeRef chip", async ({ page, api, ws, task }) => {
    const readyTask = makeTaskWithWorktree({ id: task.id });
    api.handle("tasks.list", () => [readyTask]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    ws.push({ type: "code.ref", payload: makeCodeRef({ taskId: task.id }) });
    await expect(page.locator(".code-ref-chip")).toBeVisible({ timeout: 5_000 });

    await page.locator(".code-ref-chip__dismiss").click();
    await expect(page.locator(".code-ref-chip")).not.toBeVisible({ timeout: 3_000 });
  });

  test("CS-D-3: multiple refs from same task all appear as chips", async ({ page, api, ws, task }) => {
    const readyTask = makeTaskWithWorktree({ id: task.id });
    api.handle("tasks.list", () => [readyTask]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    ws.push({ type: "code.ref", payload: makeCodeRef({ taskId: task.id, file: "/tmp/worktrees/task-1/src/a.ts", startLine: 1, endLine: 3 }) });
    ws.push({ type: "code.ref", payload: makeCodeRef({ taskId: task.id, file: "/tmp/worktrees/task-1/src/b.ts", startLine: 5, endLine: 8 }) });

    await expect(page.locator(".code-ref-chip")).toHaveCount(2, { timeout: 5_000 });
  });

  test("CS-D-4: send button is enabled when pending refs exist (even with empty text)", async ({ page, api, ws, task }) => {
    const readyTask = makeTaskWithWorktree({ id: task.id });
    api.handle("tasks.list", () => [readyTask]);

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    // Before ref: send button should be disabled (no text)
    const sendBtn = page.locator(".task-detail button:has(.pi-send), .task-detail button[aria-label='Send'], .task-detail button:has(.pi-angle-right)").first();

    ws.push({ type: "code.ref", payload: makeCodeRef({ taskId: task.id }) });
    await expect(page.locator(".code-ref-chip")).toBeVisible({ timeout: 5_000 });

    // Send button should now be enabled (ref pending)
    await expect(sendBtn).not.toBeDisabled({ timeout: 3_000 });
  });

  test("CS-D-5: sending message with pending refs calls sendMessage and clears chips", async ({ page, api, ws, task }) => {
    const readyTask = makeTaskWithWorktree({ id: task.id });
    api.handle("tasks.list", () => [readyTask]);

    let capturedContent = "";
    api.handle("tasks.sendMessage", (params: { taskId: number; content: string }) => {
      capturedContent = params.content;
      return { message: null, executionId: null };
    });

    await page.goto("/");
    await openTaskDrawer(page, task.id);

    ws.push({ type: "code.ref", payload: makeCodeRef({ taskId: task.id, file: "/tmp/worktrees/task-1/src/utils.ts", startLine: 10, endLine: 15 }) });
    await expect(page.locator(".code-ref-chip")).toBeVisible({ timeout: 5_000 });

    // Type a message and send
    const editor = page.locator(".task-detail__input .cm-content");
    await editor.click();
    await editor.pressSequentially("What does this do?");
    await page.keyboard.press("Enter");

    await expect(page.locator(".code-ref-chip")).not.toBeVisible({ timeout: 3_000 });

    // Content should include the fenced code ref block
    expect(capturedContent).toContain("```typescript");
    expect(capturedContent).toContain("// ref:");
    expect(capturedContent).toContain("utils.ts");
    expect(capturedContent).toContain("What does this do?");
  });
});
