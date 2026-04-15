import type { Task } from "@shared/rpc-types";

export type TaskActivityEvent =
  | { kind: "execution"; task: Task; previousState: string; nextState: string }
  | { kind: "workflow"; task: Task; previousState: string; nextState: string };

export function findFirstBoardInWorkspace(
  boards: Array<{ id: number; workspaceKey: string }>,
  workspaceKey: string,
): number | null {
  return boards.find((board) => board.workspaceKey === workspaceKey)?.id ?? null;
}

export function workspaceHasUnreadTasks(
  workspaceKey: string,
  boards: Array<{ id: number; workspaceKey: string }>,
  taskIndex: Record<number, { boardId: number }>,
  unreadTaskIds: Set<number>,
): boolean {
  const boardIds = new Set(
    boards.filter((board) => board.workspaceKey === workspaceKey).map((board) => board.id),
  );
  for (const taskId of unreadTaskIds) {
    const task = taskIndex[taskId];
    if (task && boardIds.has(task.boardId)) return true;
  }
  return false;
}

export function classifyTaskActivity(previous: Task | null, next: Task): TaskActivityEvent | null {
  if (!previous) return null;
  if (previous.executionState !== next.executionState) {
    return {
      kind: "execution",
      task: next,
      previousState: previous.executionState,
      nextState: next.executionState,
    };
  }
  if (previous.workflowState !== next.workflowState) {
    return {
      kind: "workflow",
      task: next,
      previousState: previous.workflowState,
      nextState: next.workflowState,
    };
  }
  return null;
}
