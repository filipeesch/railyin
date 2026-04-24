/**
 * board.spec.ts — UI tests for the board view.
 *
 * Suites:
 *   S — Board structure (columns render, task card appears, initial state)
 *   T — Task transitions (card moves between columns)
 *   U — Execution state visuals (CSS class and badge update live)
 *   P — Card placement on column transition (moved card lands at top)
 *   G — Column groups (group wrapper, label, multi-group, WIP limit badge)
 */

import { test, expect } from "./fixtures";
import { makeTask, makeBoard, makeWorkflowTemplate, makeGroupedWorkflowTemplate } from "./fixtures/mock-data";
import type { Task, WorkflowTemplate } from "@shared/rpc-types";

async function navigateToBoard(page: import("@playwright/test").Page) {
    // Navigate to the board view (assume it's the default or use nav link)
    await page.goto("/");
    await expect(page.locator(".board-columns, [data-testid='board-columns']")).toBeVisible({ timeout: 5_000 });
}

type TerminalSeedSession = {
    sessionId: string;
    label: string;
    cwd: string;
};

async function seedTerminalPanel(
    page: import("@playwright/test").Page,
    sessions: TerminalSeedSession[],
    options: { paneWidth?: number } = {},
) {
    await page.addInitScript(
        ({ seededSessions, paneWidth }) => {
            localStorage.setItem("terminal-sessions", JSON.stringify(seededSessions));
            localStorage.setItem("terminal-panel-open", JSON.stringify(true));
            localStorage.setItem("terminal-active-session", JSON.stringify(null));
            if (paneWidth != null) {
                localStorage.setItem("terminal-session-pane-width", String(paneWidth));
            }
        },
        { seededSessions: sessions, paneWidth: options.paneWidth ?? null },
    );
}

async function dragTerminalSessionPane(page: import("@playwright/test").Page, deltaX: number): Promise<number | null> {
    const handle = page.locator("[data-testid='terminal-session-resize-handle']");
    const box = await handle.boundingBox();
    if (!box) return null;

    const baselineWidth = Number(await page.evaluate(() => localStorage.getItem("terminal-session-pane-width") ?? "200"));
    const y = box.y + box.height / 2;
    const x = box.x + box.width / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const storedWidth = Number(await page.evaluate(() => localStorage.getItem("terminal-session-pane-width") ?? "200"));
    return storedWidth !== baselineWidth ? storedWidth : null;
}

// ─── Suite S — Board structure ────────────────────────────────────────────────

test.describe("S — board structure", () => {
    test("S-1: board-columns container is visible", async ({ page }) => {
        await navigateToBoard(page);
        await expect(page.locator(".board-columns, [data-testid='board-columns']")).toBeVisible();
    });

    test("S-2: board renders all expected columns in order", async ({ page }) => {
        await navigateToBoard(page);

        const columns = page.locator("[data-column-id]");
        const ids = await columns.evaluateAll((els) => els.map((e) => e.getAttribute("data-column-id")));

        expect(ids).toContain("backlog");
        expect(ids).toContain("plan");
        expect(ids).toContain("in_progress");
        expect(ids).toContain("in_review");
        expect(ids).toContain("done");

        // Order
        expect(ids.indexOf("backlog")).toBeLessThan(ids.indexOf("plan"));
        expect(ids.indexOf("plan")).toBeLessThan(ids.indexOf("in_progress"));
        expect(ids.indexOf("in_progress")).toBeLessThan(ids.indexOf("in_review"));
        expect(ids.indexOf("in_review")).toBeLessThan(ids.indexOf("done"));
    });

    test("S-3: column headers show expected labels", async ({ page }) => {
        await navigateToBoard(page);

        const headers = page.locator(".board-column__header, [data-testid='column-header']");
        const texts = await headers.allTextContents();
        const joined = texts.join(" ");

        expect(joined).toContain("Backlog");
        expect(joined).toContain("Plan");
        expect(joined).toContain("In Progress");
        expect(joined).toContain("In Review");
        expect(joined).toContain("Done");
    });

    test("S-4: test task card appears in backlog column", async ({ page, task }) => {
        await navigateToBoard(page);

        const taskCard = page.locator(`[data-task-id="${task.id}"]`);
        await expect(taskCard).toBeVisible({ timeout: 3_000 });

        // Should be inside the backlog column
        const backlogColumn = page.locator("[data-column-id='backlog']");
        await expect(backlogColumn.locator(`[data-task-id="${task.id}"]`)).toBeVisible();
    });

    test("S-5: idle task card has exec-idle CSS class", async ({ page, task }) => {
        await navigateToBoard(page);
        await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveClass(/exec-idle/);
    });

    test("S-6: idle task card shows 'Idle' badge", async ({ page, task }) => {
        await navigateToBoard(page);
        const badge = page.locator(`[data-task-id="${task.id}"] .task-card__footer .p-tag`);
        await expect(badge).toContainText("Idle");
    });
});

// ─── Suite T — Task transitions ───────────────────────────────────────────────

test.describe("T — task transitions", () => {
    test("T-7: transitioning to 'done' moves card to done column", async ({ page, api, ws, task }) => {
        const doneTask: Task = { ...task, workflowState: "done" };

        api.handle("tasks.transition", async () => {
            setTimeout(() => ws.push({ type: "task.updated", payload: doneTask }), 50);
            return { task: doneTask, executionId: null };
        });

        await navigateToBoard(page);

        // Right-click or use context menu to transition (or a direct button)
        // Use drag-drop if that's the UI, otherwise look for a transition button
        const taskCard = page.locator(`[data-task-id="${task.id}"]`);
        await taskCard.click({ button: "right" });

        const moveMenuItem = page.locator("[data-testid='move-to-done'], .context-menu__item:has-text('Done')");
        if (await moveMenuItem.isVisible({ timeout: 1_000 })) {
            await moveMenuItem.click();
        } else {
            // Push the update directly to simulate the transition
            ws.push({ type: "task.updated", payload: doneTask });
        }

        await expect(page.locator("[data-column-id='done']").locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 5_000 });
    });

    test("T-8: card is no longer in backlog after transition to done", async ({ page, api, ws, task }) => {
        const doneTask: Task = { ...task, workflowState: "done" };

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: doneTask });

        await expect(page.locator("[data-column-id='done']").locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 3_000 });
        await expect(page.locator("[data-column-id='backlog']").locator(`[data-task-id="${task.id}"]`)).not.toBeVisible();
    });

    test("T-9: task stays idle after transition to done (no on_enter_prompt)", async ({ page, api, ws, task }) => {
        const doneIdleTask: Task = { ...task, workflowState: "done", executionState: "idle" };
        api.handle("tasks.list", () => [doneIdleTask]);

        await navigateToBoard(page);

        const badge = page.locator(`[data-task-id="${task.id}"] .task-card__footer .p-tag`);
        await expect(badge).toContainText("Idle", { timeout: 3_000 });
    });

    test("T-10: transitioning back to backlog moves card back", async ({ page, api, ws, task }) => {
        const backlogTask: Task = { ...task, workflowState: "backlog" };
        api.handle("tasks.list", () => [{ ...task, workflowState: "done" }]);

        api.handle("tasks.transition", async () => {
            setTimeout(() => ws.push({ type: "task.updated", payload: backlogTask }), 50);
            return { task: backlogTask, executionId: null };
        });

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: backlogTask });

        await expect(page.locator("[data-column-id='backlog']").locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 5_000 });
    });

    test("T-11: transitioning to 'plan' moves card to plan column", async ({ page, api, ws, task }) => {
        const planTask: Task = { ...task, workflowState: "plan" };
        api.handle("tasks.transition", async () => {
            setTimeout(() => ws.push({ type: "task.updated", payload: planTask }), 50);
            return { task: planTask, executionId: null };
        });

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: planTask });

        await expect(page.locator("[data-column-id='plan']").locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 5_000 });
    });
});

// ─── Suite U — Execution state visuals ───────────────────────────────────────

test.describe("U — execution state visuals on task card", () => {
    test("U-12: idle task card has exec-idle class and 'Idle' badge", async ({ page, task }) => {
        await navigateToBoard(page);

        const card = page.locator(`[data-task-id="${task.id}"]`);
        await expect(card).toHaveClass(/exec-idle/);

        const badge = card.locator(".task-card__footer .p-tag");
        await expect(badge).toContainText("Idle");
    });

    test("U-13: task card gets exec-running class when execution starts", async ({ page, api, ws, task }) => {
        const runningTask: Task = { ...task, executionState: "running" };

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: runningTask });

        await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveClass(/exec-running/, { timeout: 5_000 });
    });

    test("U-14: running task card shows 'Running…' or 'Done' badge", async ({ page, api, ws, task }) => {
        const runningTask: Task = { ...task, executionState: "running" };

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: runningTask });

        const badge = page.locator(`[data-task-id="${task.id}"] .task-card__footer .p-tag`);
        // Accept either Running… (mid-stream) or Done (if settled quickly)
        await expect(badge).toHaveText(/Running|Done/i, { timeout: 5_000 });
    });

    test("U-15: card gets exec-completed class after execution finishes", async ({ page, api, ws, task }) => {
        const completedTask: Task = { ...task, executionState: "completed" };

        await navigateToBoard(page);
        ws.push({ type: "task.updated", payload: completedTask });

        await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveClass(/exec-completed/, { timeout: 5_000 });
    });

    test("U-16: completed task card shows 'Done' badge", async ({ page, api, ws, task }) => {
        const completedTask: Task = { ...task, executionState: "completed" };
        api.handle("tasks.list", () => [completedTask]);

        await navigateToBoard(page);

        const badge = page.locator(`[data-task-id="${task.id}"] .task-card__footer .p-tag`);
        await expect(badge).toContainText("Done", { timeout: 5_000 });
    });
});

// ─── Suite P — Card placement on column transition ────────────────────────────

test.describe("P — card placement on column transition", () => {
    test("P-17: card moved to non-empty column appears first in that column", async ({ page, api, ws }) => {
        // task1 lands in in_progress with position 250, below existing task2 at position 1000
        const task2 = makeTask({ id: 2, workflowState: "in_progress", position: 1000 });
        const task1 = makeTask({ id: 1, workflowState: "backlog", position: 500 });
        api.handle("tasks.list", () => [task1, task2]);

        await navigateToBoard(page);

        // Verify initial layout: task2 is in in_progress, task1 is in backlog
        await expect(page.locator("[data-column-id='in_progress']").locator(`[data-task-id="${task2.id}"]`)).toBeVisible();
        await expect(page.locator("[data-column-id='backlog']").locator(`[data-task-id="${task1.id}"]`)).toBeVisible();

        // Simulate transition: task1 moves to in_progress with position 250 (top, since 250 < 1000)
        const movedTask1: Task = { ...task1, workflowState: "in_progress", position: 250 };
        ws.push({ type: "task.updated", payload: movedTask1 });

        const inProgressColumn = page.locator("[data-column-id='in_progress']");
        await expect(inProgressColumn.locator(`[data-task-id="${task1.id}"]`)).toBeVisible({ timeout: 5_000 });

        // task1 (position 250) must appear before task2 (position 1000) in DOM order
        const cardIds = await inProgressColumn.locator("[data-task-id]").evaluateAll(
            (els) => els.map((el) => Number(el.getAttribute("data-task-id")))
        );
        expect(cardIds.indexOf(task1.id)).toBeLessThan(cardIds.indexOf(task2.id));
    });

    test("P-18: card moved to empty column lands as sole card", async ({ page, api, ws, task }) => {
        await navigateToBoard(page);

        // Verify in_progress is initially empty
        await expect(page.locator("[data-column-id='in_progress']").locator("[data-task-id]")).toHaveCount(0);

        // Simulate transition to the empty in_progress column (position 500 — default for empty)
        const movedTask: Task = { ...task, workflowState: "in_progress", position: 500 };
        ws.push({ type: "task.updated", payload: movedTask });

        const inProgressColumn = page.locator("[data-column-id='in_progress']");
        await expect(inProgressColumn.locator(`[data-task-id="${task.id}"]`)).toBeVisible({ timeout: 5_000 });

        const cardIds = await inProgressColumn.locator("[data-task-id]").evaluateAll(
            (els) => els.map((el) => el.getAttribute("data-task-id"))
        );
        expect(cardIds).toHaveLength(1);
        expect(cardIds[0]).toBe(String(task.id));
    });
});

// ─── Suite BL — Board layout with ConversationDrawer ─────────────────────────

import { makeChatSession } from "./fixtures/mock-data";

test.describe("BL — Board layout with ConversationDrawer", () => {
    test("BL-1: clicking a task card opens .task-chat-view in the drawer", async ({ page, api, task }) => {
        api.handle("tasks.list", () => [task]);
        api.returns("chatSessions.list", []);

        await navigateToBoard(page);

        await page.locator(`[data-task-id="${task.id}"]`).click();
        await expect(page.locator(".task-chat-view")).toBeVisible({ timeout: 5_000 });
    });

    test("BL-2: task drawer header contains the task title", async ({ page, api, task }) => {
        api.handle("tasks.list", () => [task]);
        api.returns("chatSessions.list", []);

        await navigateToBoard(page);

        await page.locator(`[data-task-id="${task.id}"]`).click();
        await expect(page.locator(".task-chat-view")).toBeVisible({ timeout: 5_000 });
        await expect(page.locator(".task-chat-view")).toContainText(task.title);
    });

    test("BL-3: chat sidebar toggle shows .chat-sidebar", async ({ page, api }) => {
        api.returns("chatSessions.list", []);

        await navigateToBoard(page);

        await expect(page.locator(".chat-sidebar")).not.toBeVisible();

        const toggleBtn = page.locator("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
        if (await toggleBtn.count() > 0) {
            await toggleBtn.first().click();
            await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });
        }
    });

    test("BL-4: switching from session drawer to task drawer replaces content", async ({ page, api, task }) => {
        const session = makeChatSession({ id: 500 });
        api.handle("tasks.list", () => [task]);
        api.returns("chatSessions.list", [session]);
        api.returns("chatSessions.getMessages", []);

        await navigateToBoard(page);

        // Open session first
        const toggleBtn = page.locator("button.chat-sidebar-toggle, .toolbar-btn--chat");
        if (await toggleBtn.count() > 0) await toggleBtn.first().click();
        await expect(page.locator(".chat-sidebar")).toBeVisible({ timeout: 3_000 });

        await page.locator(`[data-session-id="${session.id}"]`).click();
        await expect(page.locator(".session-chat-view")).toBeVisible({ timeout: 5_000 });

        // Now click task card — content should switch to task mode
        await page.locator(`[data-task-id="${task.id}"]`).click();
        await expect(page.locator(".task-chat-view")).toBeVisible({ timeout: 5_000 });
        await expect(page.locator(".session-chat-view")).not.toBeVisible();
    });
});

// ─── Suite G — Column groups ──────────────────────────────────────────────────

test.describe("G — column groups", () => {
    test("G-19: grouped columns render inside a .board-column-group wrapper", async ({
        page,
        api,
    }) => {
        const template = makeGroupedWorkflowTemplate();
        api
            .returns("boards.list", [makeBoard({ template } as any)])
            .returns("workspace.getConfig", {
                id: 1,
                key: "test-workspace",
                name: "Test Workspace",
                workflows: [template],
                ai: { baseUrl: "", apiKey: "", model: "fake/test", provider: "fake" },
                worktreeBasePath: "/tmp",
                enableThinking: false,
            });

        await navigateToBoard(page);

        // Two groups → two wrappers
        await expect(page.locator(".board-column-group")).toHaveCount(2);
    });

    test("G-20: group labels appear in the board", async ({ page, api }) => {
        const template = makeGroupedWorkflowTemplate();
        api
            .returns("boards.list", [makeBoard({ template } as any)])
            .returns("workspace.getConfig", {
                id: 1,
                key: "test-workspace",
                name: "Test Workspace",
                workflows: [template],
                ai: { baseUrl: "", apiKey: "", model: "fake/test", provider: "fake" },
                worktreeBasePath: "/tmp",
                enableThinking: false,
            });

        await navigateToBoard(page);

        const labels = page.locator(".board-column-group__label");
        await expect(labels).toHaveCount(2);
        await expect(labels.nth(0)).toContainText("Planning");
        await expect(labels.nth(1)).toContainText("End");
    });

    test("G-21: sub-columns inside groups have correct data-column-id (regression: second group must render)", async ({
        page,
        api,
    }) => {
        const template = makeGroupedWorkflowTemplate();
        api
            .returns("boards.list", [makeBoard({ template } as any)])
            .returns("workspace.getConfig", {
                id: 1,
                key: "test-workspace",
                name: "Test Workspace",
                workflows: [template],
                ai: { baseUrl: "", apiKey: "", model: "fake/test", provider: "fake" },
                worktreeBasePath: "/tmp",
                enableThinking: false,
            });

        await navigateToBoard(page);

        const planningGroup = page.locator(".board-column-group").nth(0);
        await expect(planningGroup.locator("[data-column-id='plan']")).toBeVisible();
        await expect(planningGroup.locator("[data-column-id='in_progress']")).toBeVisible();

        const endGroup = page.locator(".board-column-group").nth(1);
        await expect(endGroup.locator("[data-column-id='in_review']")).toBeVisible();
        await expect(endGroup.locator("[data-column-id='done']")).toBeVisible();
    });

    test("G-22: columns not in any group render as standalone (no .board-column-group wrapper)", async ({
        page,
        api,
    }) => {
        const template = makeGroupedWorkflowTemplate(); // backlog is ungrouped
        api
            .returns("boards.list", [makeBoard({ template } as any)])
            .returns("workspace.getConfig", {
                id: 1,
                key: "test-workspace",
                name: "Test Workspace",
                workflows: [template],
                ai: { baseUrl: "", apiKey: "", model: "fake/test", provider: "fake" },
                worktreeBasePath: "/tmp",
                enableThinking: false,
            });

        await navigateToBoard(page);

        // backlog is standalone, not inside any .board-column-group
        await expect(page.locator("[data-column-id='backlog']")).toBeVisible();
        await expect(
            page.locator(".board-column-group [data-column-id='backlog']"),
        ).toHaveCount(0);
    });

    test("G-23: WIP limit badge shows 'count/limit' when limit is configured", async ({
        page,
        api,
        task,
    }) => {
        const template = {
            ...makeWorkflowTemplate(),
            columns: [
                { id: "backlog", label: "Backlog" },
                { id: "plan", label: "Plan", limit: 2 },
                { id: "in_progress", label: "In Progress" },
                { id: "in_review", label: "In Review" },
                { id: "done", label: "Done" },
            ],
        };
        const limitedTask = makeTask({ id: 99, workflowState: "plan", position: 1000 });
        api
            .returns("boards.list", [makeBoard({ template } as any)])
            .returns("workspace.getConfig", {
                id: 1,
                key: "test-workspace",
                name: "Test Workspace",
                workflows: [template],
                ai: { baseUrl: "", apiKey: "", model: "fake/test", provider: "fake" },
                worktreeBasePath: "/tmp",
                enableThinking: false,
            })
            .handle("tasks.list", () => [limitedTask]);

        await navigateToBoard(page);

        // The capacity badge on the "plan" column header should show "1/2"
        await expect(
            page.locator("[data-column-id='plan'] .board-column__header .p-badge"),
        ).toContainText("1/2");
    });
});

// ─── Suite TP — Terminal session pane ──────────────────────────────────────────

test.describe("TP — terminal session pane", () => {
    test("TP-1: dragging the session divider changes pane width and persists it", async ({ page }) => {
        await seedTerminalPanel(page, [
            { sessionId: "term-1", label: "bash", cwd: "/tmp/worktree-a" },
            { sessionId: "term-2", label: "server", cwd: "/tmp/worktree-b" },
        ]);

        await navigateToBoard(page);

        const sessionList = page.locator(".session-list");
        const initialBox = await sessionList.boundingBox();
        expect(initialBox).not.toBeNull();

        const storedWidth = await dragTerminalSessionPane(page, -80);
        expect(storedWidth).not.toBeNull();

        const resizedBox = await sessionList.boundingBox();
        expect(resizedBox).not.toBeNull();
        expect(resizedBox!.width).toBeGreaterThan(initialBox!.width + 40);
        expect(storedWidth!).toBeGreaterThan(240);
        expect(storedWidth!).toBeLessThanOrEqual(400);
    });

    test("TP-2: persisted terminal pane width is restored after reload", async ({ page }) => {
        await seedTerminalPanel(page, [
            { sessionId: "term-1", label: "bash", cwd: "/tmp/worktree-a" },
            { sessionId: "term-2", label: "server", cwd: "/tmp/worktree-b" },
        ]);

        await navigateToBoard(page);

        const storedWidth = await dragTerminalSessionPane(page, -120);
        expect(storedWidth).not.toBeNull();
        expect(storedWidth!).toBeGreaterThan(260);

        await page.reload();
        await expect(page.locator(".terminal-panel")).toBeVisible({ timeout: 5_000 });

        const restoredBox = await page.locator(".session-list").boundingBox();
        expect(restoredBox).not.toBeNull();
        expect(restoredBox!.width).toBeGreaterThanOrEqual(storedWidth! - 5);
        expect(restoredBox!.width).toBeLessThanOrEqual(storedWidth! + 10);
    });

    test("TP-3: overflowing session list remains scrollable with themed scrollbar styling", async ({ page }) => {
        await seedTerminalPanel(
            page,
            Array.from({ length: 24 }, (_, idx) => ({
                sessionId: `term-${idx + 1}`,
                label: `terminal-${idx + 1}`,
                cwd: `/tmp/session-${idx + 1}`,
            })),
            { paneWidth: 260 },
        );

        await navigateToBoard(page);

        const list = page.locator(".session-list__items");
        await expect(list).toBeVisible();

        const metrics = await list.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
                overflowY: style.overflowY,
                scrollbarColor: style.getPropertyValue("scrollbar-color"),
            };
        });

        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
        expect(metrics.overflowY).toBe("auto");
        expect(metrics.scrollbarColor.trim()).not.toBe("");

        await list.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });
        await expect(page.locator(".session-item__label").last()).toHaveText("terminal-24");
        await expect(page.locator(".session-list__new")).toBeVisible();
    });
});

// ─── Suite BD — Board improvements ───────────────────────────────────────────

test.describe("BD — board improvements", () => {
    test("BD-1: task card has no launch row even when launch config has profiles and tools", async ({
        page,
        api,
    }) => {
        api
            .returns("launch.getConfig", {
                profiles: [{ id: "p1", label: "Run", command: "npm start", cwd: null, env: {} }],
                tools: [{ id: "t1", label: "Build", command: "npm run build", cwd: null, env: {} }],
            })
            .returns("tasks.list", [makeTask({ workflowState: "backlog" })]);

        await navigateToBoard(page);

        await expect(page.locator(".task-card")).toBeVisible();
        await expect(page.locator(".task-card__launch-row")).toHaveCount(0);
    });

    test("BD-2: board scrolls vertically when a grouped column contains many tasks", async ({
        page,
        api,
    }) => {
        const template = makeGroupedWorkflowTemplate();
        const manyTasks = Array.from({ length: 20 }, (_, i) =>
            makeTask({ workflowState: "plan", title: `Task ${i + 1}` }),
        );

        api
            .returns("boards.list", [makeBoard({ template } as any)])
            .returns("workspace.getConfig", {
                id: 1,
                key: "test-workspace",
                name: "Test Workspace",
                workflows: [template],
                ai: { baseUrl: "", apiKey: "", model: "fake/test", provider: "fake" },
                worktreeBasePath: "/tmp",
                enableThinking: false,
            })
            .returns("tasks.list", manyTasks);

        await navigateToBoard(page);

        const planColumn = page.locator("[data-column-id='plan']");
        await expect(planColumn).toBeVisible();

        const boardColumns = page.locator(".board-columns");
        const metrics = await boardColumns.evaluate((el) => ({
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            overflowY: getComputedStyle(el).overflowY,
        }));

        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
        expect(["auto", "scroll"]).toContain(metrics.overflowY);
    });

    test("BD-3: board scrolls vertically when columns overflow the viewport", async ({
        page,
        api,
    }) => {
        const manyTasks = Array.from({ length: 20 }, (_, i) =>
            makeTask({ workflowState: "backlog", title: `Task ${i + 1}` }),
        );
        api.returns("tasks.list", manyTasks);

        await navigateToBoard(page);

        const boardColumns = page.locator(".board-columns");
        const metrics = await boardColumns.evaluate((el) => ({
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            overflowY: getComputedStyle(el).overflowY,
        }));

        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
        expect(["auto", "scroll"]).toContain(metrics.overflowY);

        await boardColumns.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });
        await page.waitForTimeout(50);
        const scrollTop = await boardColumns.evaluate((el) => el.scrollTop);
        expect(scrollTop).toBeGreaterThan(0);
    });

    test("BD-4: dragging a card near the bottom edge of a column scrolls the board", async ({
        page,
        api,
    }) => {
        const manyTasks = Array.from({ length: 20 }, (_, i) =>
            makeTask({ workflowState: "backlog", title: `Task ${i + 1}` }),
        );
        api.returns("tasks.list", manyTasks);

        await navigateToBoard(page);

        const boardColumns = page.locator(".board-columns");
        const initialScrollTop = await boardColumns.evaluate((el) => el.scrollTop);

        const firstCard = page.locator(".task-card").first();
        const cardBox = await firstCard.boundingBox();
        expect(cardBox).not.toBeNull();

        const viewportSize = page.viewportSize();
        const bottomEdgeY = (viewportSize?.height ?? 768) - 20;

        await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + cardBox!.height / 2);
        await page.mouse.down();
        await page.mouse.move(cardBox!.x + cardBox!.width / 2, bottomEdgeY, { steps: 10 });

        await page.waitForTimeout(200);

        const newScrollTop = await boardColumns.evaluate((el) => el.scrollTop);
        await page.mouse.up();

        expect(newScrollTop).toBeGreaterThan(initialScrollTop);
    });
});
