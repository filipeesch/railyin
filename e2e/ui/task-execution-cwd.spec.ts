/**
 * task-execution-cwd.spec.ts — UI tests for worktree CWD isolation.
 *
 * Verifies that the Git tab surfaces the worktree path as the agent's
 * working directory, NOT the project path, when a worktree is ready.
 *
 * Suites:
 *   CWD-A — Static display: correct path shown per worktree state
 *   CWD-B — Live update: path reflects WS task.updated events
 */

import { test, expect } from "./fixtures";
import { makeTask, makeWorkspace } from "./fixtures/mock-data";
import type { Task } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_PATH = "/home/user/myrepo";
const WORKTREE_PATH = "/tmp/railyn-worktrees/task-1-fix-bug";
const MONOREPO_WORKTREE_PATH = "/tmp/railyn-worktrees/task-2-api/packages/api";

async function openGitTab(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
    await page.locator(".tab-btn", { hasText: "Git" }).click();
    await expect(page.locator(".task-tab-git")).toBeVisible();
}

function makeReadyTask(overrides: Partial<Task> = {}): Task {
    return makeTask({
        worktreeStatus: "ready",
        branchName: "task/1-fix-bug",
        worktreePath: WORKTREE_PATH,
        ...overrides,
    });
}

// ─── Suite CWD-A — Static display ─────────────────────────────────────────────

test.describe("CWD-A — static working directory display", () => {
    test("CWD-A-1: ready worktree shows worktree path, not project path", async ({ page, api }) => {
        const task = makeReadyTask();
        api.handle("tasks.list", () => [task]);
        api.handle("workspace.get", () => makeWorkspace());

        await page.goto("/");
        await openGitTab(page, task.id);

        // The Info tab must show the worktree path
        await expect(
            page.locator(".task-tab-git .info-value--mono", { hasText: WORKTREE_PATH }),
        ).toBeVisible();

        // Project path must not appear as a separate value (worktree replaced it)
        await expect(
            page.locator(".task-tab-git .info-value--mono", { hasText: PROJECT_PATH }),
        ).not.toBeVisible();
    });

    test("CWD-A-2: worktree not yet created → section visible with no path", async ({ page, api }) => {
        const task = makeTask({ worktreeStatus: null, worktreePath: null });
        api.handle("tasks.list", () => [task]);
        api.handle("workspace.get", () => makeWorkspace());

        await page.goto("/");
        await openGitTab(page, task.id);

        // Section IS rendered (shows "not configured" status + create form)
        await expect(
            page.locator(".task-tab-git .info-section", { hasText: "Worktree" }),
        ).toBeVisible();
        // No worktree path row visible (there's no worktree yet)
        await expect(
            page.locator(".task-tab-git .info-value--mono", { hasText: PROJECT_PATH }),
        ).not.toBeVisible();
    });

    test("CWD-A-3: monorepo worktree path (sub-path inside worktree) is shown", async ({
        page,
        api,
    }) => {
        const task = makeReadyTask({
            branchName: "task/2-api",
            worktreePath: MONOREPO_WORKTREE_PATH,
        });
        api.handle("tasks.list", () => [task]);
        api.handle("workspace.get", () => makeWorkspace());

        await page.goto("/");
        await openGitTab(page, task.id);

        await expect(
            page.locator(".task-tab-git .info-value--mono", { hasText: MONOREPO_WORKTREE_PATH }),
        ).toBeVisible();
    });
});

// ─── Suite CWD-B — Live update via WS ─────────────────────────────────────────

test.describe("CWD-B — live path update via WebSocket", () => {
    test("CWD-B-1: worktree path appears after task.updated with ready status", async ({
        page,
        api,
        ws,
    }) => {
        // Task starts with no worktree (null status — section visible, form shown)
        const pendingTask = makeTask({ worktreeStatus: null, worktreePath: null });
        api.handle("tasks.list", () => [pendingTask]);
        api.handle("workspace.get", () => makeWorkspace());

        await page.goto("/");
        await openGitTab(page, pendingTask.id);

        // Worktree section is visible (shows create form for null status)
        await expect(
            page.locator(".task-tab-git .info-section", { hasText: "Worktree" }),
        ).toBeVisible();
        // No path row yet
        await expect(
            page.locator(".task-tab-git .info-value--mono", { hasText: WORKTREE_PATH }),
        ).not.toBeVisible();

        // Backend signals worktree is ready
        const readyTask: Task = {
            ...pendingTask,
            worktreeStatus: "ready",
            branchName: "task/1-fix-bug",
            worktreePath: WORKTREE_PATH,
        };
        ws.push({ type: "task.updated", payload: readyTask });

        // Worktree path should now appear
        await expect(
            page.locator(".task-tab-git .info-value--mono", { hasText: WORKTREE_PATH }),
        ).toBeVisible({ timeout: 5_000 });
    });

    test("CWD-B-2: worktree path disappears after task.updated removes worktree", async ({
        page,
        api,
        ws,
    }) => {
        const readyTask = makeReadyTask();
        api.handle("tasks.list", () => [readyTask]);
        api.handle("workspace.get", () => makeWorkspace());

        await page.goto("/");
        await openGitTab(page, readyTask.id);

        // Path is visible initially
        await expect(
            page.locator(".task-tab-git .info-value--mono", { hasText: WORKTREE_PATH }),
        ).toBeVisible();

        // Worktree removed
        const removedTask: Task = {
            ...readyTask,
            worktreeStatus: "removed",
            worktreePath: null,
        };
        ws.push({ type: "task.updated", payload: removedTask });

        // Path row should disappear
        await expect(
            page.locator(".task-tab-git .info-value--mono", { hasText: WORKTREE_PATH }),
        ).not.toBeVisible({ timeout: 5_000 });
    });
});
