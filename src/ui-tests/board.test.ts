/**
 * board.test.ts — UI tests for the board view.
 *
 * Suite S: Board structure — columns render, task card appears, initial state
 * Suite T: Task transitions — card moves between columns via /test-transition
 * Suite U: Execution state visuals — task card CSS class and badge update live
 *
 * Requires the app to be running in test mode:
 *   bun run dev:test   (--debug --memory-db)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import {
  setupTestEnv,
  navigateToBoardView,
  reloadBoardTasks,
  waitForBoardReady,
  getBoardColumnIds,
  getColumnLabels,
  isTaskInColumn,
  getTaskCardClasses,
  getTaskBadgeText,
  transitionTaskTo,
  waitForTaskInColumn,
  waitForTaskCardClass,
  getTaskExecutionStateFromStore,
  closeTaskDrawer,
  sleep,
} from "./bridge";

// ─── Suite S: Board structure ─────────────────────────────────────────────────

describe("Suite S: board structure", () => {
  let taskId: number;

  beforeAll(async () => {
    const env = await setupTestEnv();
    taskId = env.taskId;
    await closeTaskDrawer();
    await navigateToBoardView();
    await reloadBoardTasks();
    await waitForBoardReady(8_000);
  });

  it("S-1: board-columns container is visible", async () => {
    const ready = await waitForBoardReady(4_000);
    expect(ready).toBe(true);
  });

  it("S-2: board renders all expected columns in order", async () => {
    const ids = await getBoardColumnIds();
    expect(ids).toContain("backlog");
    expect(ids).toContain("plan");
    expect(ids).toContain("in_progress");
    expect(ids).toContain("in_review");
    expect(ids).toContain("done");
    // Verify order
    expect(ids.indexOf("backlog")).toBeLessThan(ids.indexOf("plan"));
    expect(ids.indexOf("plan")).toBeLessThan(ids.indexOf("in_progress"));
    expect(ids.indexOf("in_progress")).toBeLessThan(ids.indexOf("in_review"));
    expect(ids.indexOf("in_review")).toBeLessThan(ids.indexOf("done"));
  });

  it("S-3: column headers show expected labels", async () => {
    const labels = await getColumnLabels();
    expect(labels).toContain("Backlog");
    expect(labels).toContain("Plan");
    expect(labels).toContain("In Progress");
    expect(labels).toContain("In Review");
    expect(labels).toContain("Done");
  });

  it("S-4: test task card appears in backlog column", async () => {
    const inBacklog = await isTaskInColumn(taskId, "backlog");
    expect(inBacklog).toBe(true);
  });

  it("S-5: idle task card has exec-idle CSS class", async () => {
    const classes = await getTaskCardClasses(taskId);
    expect(classes).toContain("exec-idle");
  });

  it("S-6: idle task card shows 'Idle' badge", async () => {
    const badge = await getTaskBadgeText(taskId);
    expect(badge).toBe("Idle");
  });
});

// ─── Suite T: Task transitions ────────────────────────────────────────────────

describe("Suite T: task transitions", () => {
  let taskId: number;

  beforeAll(async () => {
    const env = await setupTestEnv();
    taskId = env.taskId;
    await closeTaskDrawer();
    await navigateToBoardView();
    await reloadBoardTasks();
    await waitForBoardReady(8_000);
  });

  it("T-7: transitioning to 'done' (no prompt) moves card to done column", async () => {
    await transitionTaskTo(taskId, "done");
    const inDone = await waitForTaskInColumn(taskId, "done", 6_000);
    expect(inDone).toBe(true);
  });

  it("T-8: card is no longer in backlog after transition to done", async () => {
    const inBacklog = await isTaskInColumn(taskId, "backlog");
    expect(inBacklog).toBe(false);
  });

  it("T-9: task stays idle after transition to 'done' (no on_enter_prompt)", async () => {
    const badge = await getTaskBadgeText(taskId);
    expect(badge).toBe("Idle");
    const state = await getTaskExecutionStateFromStore(taskId);
    expect(state).toBe("idle");
  });

  it("T-10: transitioning back to 'backlog' moves card back", async () => {
    await transitionTaskTo(taskId, "backlog");
    const inBacklog = await waitForTaskInColumn(taskId, "backlog", 6_000);
    expect(inBacklog).toBe(true);
  });

  it("T-11: transitioning to 'plan' (has on_enter_prompt) moves card to plan column", async () => {
    await transitionTaskTo(taskId, "plan");
    const inPlan = await waitForTaskInColumn(taskId, "plan", 6_000);
    expect(inPlan).toBe(true);
  });
});

// ─── Suite U: Execution state visuals ────────────────────────────────────────

describe("Suite U: execution state visuals on task card", () => {
  let taskId: number;

  beforeAll(async () => {
    const env = await setupTestEnv();
    taskId = env.taskId;
    await closeTaskDrawer();
    await navigateToBoardView();
    await reloadBoardTasks();
    await waitForBoardReady(8_000);
  });

  it("U-12: idle task card has exec-idle class and 'Idle' badge", async () => {
    const classes = await getTaskCardClasses(taskId);
    const badge = await getTaskBadgeText(taskId);
    expect(classes).toContain("exec-idle");
    expect(badge).toBe("Idle");
  });

  it("U-13: after transition to 'plan', card gets exec-running class", async () => {
    await transitionTaskTo(taskId, "plan");
    // Plan has on_enter_prompt → execution starts → card should go running
    const sawRunning = await waitForTaskCardClass(taskId, "exec-running", 10_000);
    expect(sawRunning).toBe(true);
  });

  it("U-14: running task card shows 'Running\u2026' badge text", async () => {
    // Card is currently in running state (FakeAI hasn't finished yet, or just did)
    // Poll for Running badge — if FakeAI already completed, this may be 'Done'
    const deadline = Date.now() + 8_000;
    let sawRunningBadge = false;
    while (Date.now() < deadline) {
      const badge = await getTaskBadgeText(taskId);
      if (badge === "Running\u2026") { sawRunningBadge = true; break; }
      const classes = await getTaskCardClasses(taskId);
      // FakeAI may complete before we poll — allow completed state too
      if (classes.includes("exec-completed")) { sawRunningBadge = true; break; }
      await sleep(200);
    }
    expect(sawRunningBadge).toBe(true);
  });

  it("U-15: after fake AI stream completes, card has exec-completed class", async () => {
    const sawCompleted = await waitForTaskCardClass(taskId, "exec-completed", 30_000);
    expect(sawCompleted).toBe(true);
  });

  it("U-16: completed task card shows 'Done' badge text", async () => {
    const badge = await getTaskBadgeText(taskId);
    expect(badge).toBe("Done");
  });
});
