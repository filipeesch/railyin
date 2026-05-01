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
import { makeTask, makeWorkflowTemplate, setupBoardWithTemplate } from "./fixtures/mock-data";
import type { Task, WorkflowTemplate } from "@shared/rpc-types";

const restrictedTemplate: WorkflowTemplate = {
    id: "restricted",
    name: "Restricted",
    columns: [
        { id: "backlog", label: "Backlog", allowedTransitions: ["plan"] },
        { id: "plan", label: "Plan" },
        { id: "in_progress", label: "In Progress" },
        { id: "done", label: "Done" },
    ],
} as WorkflowTemplate;

const frozenTemplate: WorkflowTemplate = {
    id: "frozen",
    name: "Frozen",
    columns: [
        { id: "backlog", label: "Backlog", allowedTransitions: [] },
        { id: "plan", label: "Plan" },
        { id: "done", label: "Done" },
    ],
} as WorkflowTemplate;

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

    test("TT-12: Select shows only current + allowed columns when allowedTransitions is set", async ({ page, api }) => {
        const task = makeTask({ id: 12, workflowState: "backlog" });
        setupBoardWithTemplate(api, restrictedTemplate);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".workflow-select").click();

        const options = page.locator(".p-select-option");
        await expect(options).toHaveCount(2);
        await expect(options.nth(0)).toContainText("Backlog");
        await expect(options.nth(1)).toContainText("Plan");
    });

    test("TT-13: current column option is disabled in Select", async ({ page, api }) => {
        const task = makeTask({ id: 13, workflowState: "backlog" });
        setupBoardWithTemplate(api, restrictedTemplate);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".workflow-select").click();

        const currentOption = page.locator(".p-select-option", { hasText: "Backlog" });
        await expect(currentOption).toHaveAttribute("aria-disabled", "true");
    });

    test("TT-14: forbidden column is absent from Select options when allowedTransitions is set", async ({ page, api }) => {
        const task = makeTask({ id: 14, workflowState: "backlog" });
        setupBoardWithTemplate(api, restrictedTemplate);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".workflow-select").click();

        await expect(page.locator(".p-select-option", { hasText: "In Progress" })).not.toBeAttached();
        await expect(page.locator(".p-select-option", { hasText: "Done" })).not.toBeAttached();
    });

    test("TT-15: frozen column (allowedTransitions: []) shows only current option disabled", async ({ page, api }) => {
        const task = makeTask({ id: 15, workflowState: "backlog" });
        setupBoardWithTemplate(api, frozenTemplate);
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".workflow-select").click();

        const options = page.locator(".p-select-option");
        await expect(options).toHaveCount(1);
        const onlyOption = options.nth(0);
        await expect(onlyOption).toContainText("Backlog");
        await expect(onlyOption).toHaveAttribute("aria-disabled", "true");
    });

    test("TT-16: selecting an allowed option triggers tasks.transition", async ({ page, api }) => {
        const task = makeTask({ id: 16, workflowState: "backlog" });
        const updatedTask: Task = { ...task, workflowState: "plan" };
        setupBoardWithTemplate(api, restrictedTemplate);
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

    test("TT-17: Select shows all columns when allowedTransitions is undefined", async ({ page, api }) => {
        const task = makeTask({ id: 17, workflowState: "backlog" });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".workflow-select").click();

        const options = page.locator(".p-select-option");
        await expect(options).toHaveCount(5);
    });

    test("TT-18: current column is disabled when allowedTransitions is undefined", async ({ page, api }) => {
        const task = makeTask({ id: 18, workflowState: "backlog" });
        api.handle("tasks.list", () => [task]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".workflow-select").click();

        const currentOption = page.locator(".p-select-option", { hasText: "Backlog" });
        await expect(currentOption).toHaveAttribute("aria-disabled", "true");
    });
});
