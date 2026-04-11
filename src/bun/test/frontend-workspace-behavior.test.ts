import { describe, expect, it } from "bun:test";
import type { Task } from "../../shared/rpc-types.ts";
import {
  classifyTaskActivity,
  findFirstBoardInWorkspace,
  workspaceHasUnreadTasks,
  type TaskActivityEvent,
} from "../../mainview/workspace-helpers.ts";
import { getTaskActivityToast } from "../../mainview/task-activity.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    boardId: 10,
    projectId: 100,
    title: "Test task",
    description: "Task description",
    workflowState: "backlog",
    executionState: "idle",
    conversationId: 1,
    currentExecutionId: null,
    retryCount: 0,
    createdFromTaskId: null,
    createdFromExecutionId: null,
    model: null,
    shellAutoApprove: false,
    approvedCommands: [],
    worktreeStatus: null,
    branchName: null,
    worktreePath: null,
    executionCount: 0,
    ...overrides,
  };
}

describe("frontend workspace behavior", () => {
  it("selects the first board in the active workspace", () => {
    expect(findFirstBoardInWorkspace([
      { id: 10, workspaceId: 1 },
      { id: 20, workspaceId: 2 },
    ], 2)).toBe(20);
  });

  it("aggregates unread state from tasks to the owning workspace tab", () => {
    expect(workspaceHasUnreadTasks(
      1,
      [{ id: 10, workspaceId: 1 }, { id: 20, workspaceId: 2 }],
      {
        1: { boardId: 10 },
        2: { boardId: 20 },
      },
      new Set([1]),
    )).toBe(true);

    expect(workspaceHasUnreadTasks(
      2,
      [{ id: 10, workspaceId: 1 }, { id: 20, workspaceId: 2 }],
      {
        1: { boardId: 10 },
        2: { boardId: 20 },
      },
      new Set([1]),
    )).toBe(false);
  });

  it("classifies execution and workflow updates for unread/toast handling", () => {
    const previous = makeTask({ executionState: "idle", workflowState: "backlog" });
    expect(classifyTaskActivity(previous, makeTask({ executionState: "running" }))).toEqual({
      kind: "execution",
      task: makeTask({ executionState: "running" }),
      previousState: "idle",
      nextState: "running",
    });
    expect(classifyTaskActivity(previous, makeTask({ workflowState: "plan" }))).toEqual({
      kind: "workflow",
      task: makeTask({ workflowState: "plan" }),
      previousState: "backlog",
      nextState: "plan",
    });
  });

  it("maps execution activity to toast payloads", () => {
    const activity: TaskActivityEvent = {
      kind: "execution",
      task: makeTask({ title: "Ship release" }),
      previousState: "running",
      nextState: "completed",
    };

    expect(getTaskActivityToast(activity, "Work Projects")).toEqual({
      severity: "success",
      summary: "Task completed",
      detail: "Work Projects - Ship release",
      life: 4000,
    });
  });

  it("maps workflow-only moves to info toasts", () => {
    const activity: TaskActivityEvent = {
      kind: "workflow",
      task: makeTask({ title: "Refine spec" }),
      previousState: "backlog",
      nextState: "plan",
    };

    expect(getTaskActivityToast(activity, "Personal Projects")).toEqual({
      severity: "info",
      summary: "Task moved",
      detail: "Personal Projects - Refine spec",
      life: 4000,
    });
  });
});
