import type { Database } from "bun:sqlite";
import type { WorkflowColumnConfig } from "../config/index.ts";
import { getWorkspaceConfig } from "../workspace-context.ts";

export type TransitionResult =
  | { ok: true; boardId: number; fromCol: WorkflowColumnConfig; toCol: WorkflowColumnConfig }
  | { ok: false; reason: string };

type TaskBoardRow = {
  workflow_state: string;
  board_id: number;
  workflow_template_id: string;
  workspace_key: string;
};

/**
 * Validates whether a task can transition to a given workflow state.
 *
 * Checks in fail-fast order:
 *   1. Task exists
 *   2. Target column exists in the workflow template
 *   3. Target column is not at capacity
 *   4. Source column's allowed_transitions (if defined) includes the target
 */
export function validateTransition(
  db: Database,
  taskId: number,
  toState: string,
): TransitionResult {
  const taskRow = db
    .query<TaskBoardRow, [number]>(
      `SELECT t.workflow_state, t.board_id, b.workflow_template_id, b.workspace_key
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       WHERE t.id = ?`,
    )
    .get(taskId);

  if (!taskRow) {
    return { ok: false, reason: `task ${taskId} not found` };
  }

  const wsConfig = getWorkspaceConfig(taskRow.workspace_key);
  const template = wsConfig.workflows.find((w) => w.id === taskRow.workflow_template_id);

  const toCol = template?.columns.find((c) => c.id === toState);
  if (!toCol) {
    const valid = template?.columns.map((c) => c.id).join(", ") ?? "(unknown)";
    return {
      ok: false,
      reason: `workflow_state "${toState}" not found in board template. Valid columns: ${valid}`,
    };
  }

  if (toCol.limit != null) {
    const countRow = db
      .query<{ count: number }, [number, string]>(
        "SELECT COUNT(*) as count FROM tasks WHERE board_id = ? AND workflow_state = ?",
      )
      .get(taskRow.board_id, toState);
    if ((countRow?.count ?? 0) >= toCol.limit) {
      return {
        ok: false,
        reason: `Column "${toState}" is at capacity (${countRow?.count}/${toCol.limit}). Move a card out first.`,
      };
    }
  }

  const fromCol = template?.columns.find((c) => c.id === taskRow.workflow_state);
  if (fromCol?.allowed_transitions !== undefined) {
    if (!fromCol.allowed_transitions.includes(toState)) {
      return {
        ok: false,
        reason: `Transition from "${taskRow.workflow_state}" to "${toState}" is not allowed.`,
      };
    }
  }

  return { ok: true, boardId: taskRow.board_id, fromCol: fromCol ?? toCol, toCol };
}
