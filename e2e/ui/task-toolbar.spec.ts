/**
 * task-toolbar.spec.ts — Tests for the TaskChatView toolbar action guards.
 *
 * Suite: TT — toolbar action guards
 * Tests cover: workflow select display and transition API call,
 * terminal and code-editor button visibility guards (worktreePath),
 * retry button visibility (executionState), delete dialog open/cancel/confirm.
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";
import type { Task } from "@shared/rpc-types";

test.describe("TT — toolbar action guards", () => {
    test("TT-1: workflow select shows current column label", async ({ page, api }) => {
        const task = makeTask({ id: 1, workflowState: "in_progress" });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".workflow-select .p-select-label")).toContainText("In Progress");
    });

    test("TT-2: changing workflow select triggers tasks.transition", async ({ page, api }) => {
        const task = makeTask({ id: 2 });
        const updatedTask: Task = { ...task, workflowState: "plan" };
        api.handle("tasks.list", () => [task]);
        const calls = api.capture("tasks.transition", { task: updatedTask });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".workflow-select").click();
        await page.locator(".p-select-option", { hasText: "Plan" }).click();

        await page.waitForTimeout(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].taskId).toBe(task.id);
    });

    test("TT-3: terminal button hidden when worktreePath is null", async ({ page, api }) => {
        const task = makeTask({ id: 3, worktreePath: null });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".tcv-toolbar button:has(.pi-desktop)")).not.toBeAttached();
    });

    test("TT-4: terminal button visible when worktreePath is set", async ({ page, api }) => {
        const task = makeTask({ id: 4, worktreePath: "/tmp/test" });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".tcv-toolbar button:has(.pi-desktop)")).toBeVisible({ timeout: 3_000 });
    });

    test("TT-5: code editor button hidden when worktreePath is null", async ({ page, api }) => {
        const task = makeTask({ id: 5, worktreePath: null });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".task-detail__code-btn")).not.toBeAttached();
    });

    test("TT-6: code editor button visible when worktreePath is set", async ({ page, api }) => {
        const task = makeTask({ id: 6, worktreePath: "/tmp/test" });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".task-detail__code-btn")).toBeVisible({ timeout: 3_000 });
    });

    test("TT-7: retry button hidden when executionState is idle", async ({ page, api }) => {
        const task = makeTask({ id: 7, executionState: "idle" });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".tcv-toolbar button:has(.pi-replay)")).not.toBeAttached();
    });

    test("TT-8: retry button visible when executionState is failed", async ({ page, api }) => {
        const task = makeTask({ id: 8, executionState: "failed" });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".tcv-toolbar button:has(.pi-replay)")).toBeVisible({ timeout: 3_000 });
    });

    test("TT-9: delete button opens dialog with Delete task header", async ({ page, api }) => {
        const task = makeTask({ id: 9 });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".p-dialog")).not.toBeAttached();

        await page.locator(".tcv-header__actions button:has(.pi-trash)").click();

        await expect(page.locator(".p-dialog-header")).toContainText("Delete task", { timeout: 3_000 });
    });

    test("TT-10: delete dialog Cancel dismisses without calling tasks.delete", async ({ page, api }) => {
        const task = makeTask({ id: 10 });
        api.handle("tasks.list", () => [task]);
        const deleteCalls = api.capture("tasks.delete", {} as any);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".tcv-header__actions button:has(.pi-trash)").click();
        await expect(page.locator(".p-dialog-header")).toContainText("Delete task", { timeout: 3_000 });

        await page.locator(".p-dialog-footer button", { hasText: "Cancel" }).click();

        await expect(page.locator(".p-dialog")).not.toBeVisible({ timeout: 2_000 });
        expect(deleteCalls).toHaveLength(0);
    });

    test("TT-11: delete dialog Delete button calls tasks.delete with correct task id", async ({ page, api }) => {
        const task = makeTask({ id: 11 });
        api.handle("tasks.list", () => [task]);
        const deleteCalls = api.capture("tasks.delete", {} as any);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".tcv-header__actions button:has(.pi-trash)").click();
        await expect(page.locator(".p-dialog-header")).toContainText("Delete task", { timeout: 3_000 });

        await page.locator(".p-dialog-footer button", { hasText: "Delete" }).click();

        await page.waitForTimeout(300);
        expect(deleteCalls).toHaveLength(1);
        expect(deleteCalls[0].taskId).toBe(task.id);
    });
});
