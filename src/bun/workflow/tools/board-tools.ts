import { getDb } from "../../db/index.ts";
import { getConfig } from "../../config/index.ts";
import type { TaskRow, ConversationMessageRow } from "../../db/row-types.ts";
import { mapTask, mapConversationMessage } from "../../db/mappers.ts";
import { removeWorktree } from "../../git/worktree.ts";
import { getProjectByKey } from "../../project-store.ts";
import { taskLspRegistry } from "../../lsp/task-registry.ts";
import type { BoardToolContext } from "./types.ts";

const TASK_WITH_GIT = `
  SELECT t.*,
         gc.worktree_status, gc.branch_name, gc.worktree_path,
         (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
  FROM tasks t
  LEFT JOIN task_git_context gc ON gc.task_id = t.id
  WHERE t.id = ?`;

export async function execGetTask(
  args: Record<string, unknown>,
  ctx: BoardToolContext,
): Promise<string> {
  const taskId = Number(args.task_id);
  if (!taskId || isNaN(taskId)) return "Error: task_id is required";
  const db = getDb();
  const row = db.query<TaskRow, [number]>(TASK_WITH_GIT).get(taskId);
  if (!row) return `Error: task ${taskId} not found`;
  const task = mapTask(row);
  const includeN = args.include_messages != null ? Number(args.include_messages) : 0;
  if (includeN > 0) {
    const msgs = db
      .query<ConversationMessageRow, [number, number]>(
        `SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(taskId, includeN)
      .reverse()
      .map(mapConversationMessage);
    return JSON.stringify({ task, messages: msgs });
  }
  return JSON.stringify(task);
}

export async function execGetBoardSummary(
  args: Record<string, unknown>,
  ctx: BoardToolContext,
): Promise<string> {
  const db = getDb();
  const boardId = args.board_id != null ? Number(args.board_id) : (ctx.boardId ?? 0);
  if (!boardId) return "Error: board_id is required (or run this tool from a task on a board)";
  const boardRow = db.query<{ id: number }, [number]>("SELECT id FROM boards WHERE id = ?").get(boardId);
  if (!boardRow) return `Error: board ${boardId} not found`;
  const rows = db
    .query<{ workflow_state: string; execution_state: string; count: number }, [number]>(
      `SELECT workflow_state, execution_state, COUNT(*) as count
       FROM tasks WHERE board_id = ?
       GROUP BY workflow_state, execution_state`,
    )
    .all(boardId);
  const columns: Record<string, { total: number; by_state: Record<string, number> }> = {};
  for (const r of rows) {
    if (!columns[r.workflow_state]) columns[r.workflow_state] = { total: 0, by_state: {} };
    columns[r.workflow_state].total += r.count;
    columns[r.workflow_state].by_state[r.execution_state] =
      (columns[r.workflow_state].by_state[r.execution_state] ?? 0) + r.count;
  }
  return JSON.stringify({ board_id: boardId, columns });
}

export async function execListTasks(
  args: Record<string, unknown>,
  ctx: BoardToolContext,
): Promise<string> {
  const db = getDb();
  const boardId = args.board_id != null ? Number(args.board_id) : (ctx.boardId ?? 0);
  if (!boardId) return "Error: board_id is required (or run this tool from a task on a board)";
  const limitRaw = args.limit != null ? Number(args.limit) : 50;
  const limit = Math.min(Math.max(1, limitRaw), 200);
  const conditions: string[] = ["t.board_id = ?"];
  const params: (string | number)[] = [boardId];
  if (args.workflow_state) { conditions.push("t.workflow_state = ?"); params.push(args.workflow_state as string); }
  if (args.execution_state) { conditions.push("t.execution_state = ?"); params.push(args.execution_state as string); }
  if (args.project_key) { conditions.push("t.project_key = ?"); params.push(args.project_key as string); }
  if (args.query) {
    conditions.push("(t.title LIKE ? OR t.description LIKE ?)");
    const q = `%${args.query as string}%`;
    params.push(q, q);
  }
  params.push(limit);
  const sql = `SELECT t.*,
                      gc.worktree_status, gc.branch_name, gc.worktree_path,
                      (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
               FROM tasks t
               LEFT JOIN task_git_context gc ON gc.task_id = t.id
               WHERE ${conditions.join(" AND ")}
               ORDER BY t.created_at ASC LIMIT ?`;
  const rows = db.query<TaskRow, typeof params>(sql).all(...params);
  return JSON.stringify(rows.map(mapTask));
}

export async function execCreateTask(
  args: Record<string, unknown>,
  ctx: BoardToolContext,
): Promise<string> {
  const projectKey = ((args.project_key as string) ?? "").trim();
  if (!projectKey) return "Error: project_key is required";
  const title = ((args.title as string) ?? "").trim();
  if (!title) return "Error: title is required";
  const description = ((args.description as string) ?? "").trim();
  const boardId = args.board_id != null ? Number(args.board_id) : (ctx.boardId ?? 0);
  if (!boardId) return "Error: board_id is required (or run this tool from a task on a board)";
  const db = getDb();
  const boardRow = db
    .query<{ id: number; workspace_key: string }, [number]>(
      "SELECT id, workspace_key FROM boards WHERE id = ?",
    )
    .get(boardId);
  if (!boardRow) return `Error: board ${boardId} not found`;
  const project = getProjectByKey(boardRow.workspace_key, projectKey);
  if (!project) return `Error: project ${projectKey} not found`;
  const convRes = db.run("INSERT INTO conversations (task_id) VALUES (0)");
  const convId = convRes.lastInsertRowid as number;
  const config = getConfig();
  const engineDefaultModel = "model" in config.engine ? (config.engine.model ?? null) : null;
  const effectiveModel = (args.model as string) || engineDefaultModel || config.workspace.default_model || null;
  const taskRes = db.run(
    `INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id${effectiveModel ? ", model" : ""})
     VALUES (?, ?, ?, ?, 'backlog', 'idle', ?${effectiveModel ? ", ?" : ""})`,
    effectiveModel
      ? [boardId, projectKey, title, description, convId, effectiveModel]
      : [boardId, projectKey, title, description, convId],
  );
  const newTaskId = taskRes.lastInsertRowid as number;
  db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [newTaskId, convId]);
  const newRow = db.query<TaskRow, [number]>(TASK_WITH_GIT).get(newTaskId)!;
  return JSON.stringify(mapTask(newRow));
}

export async function execEditTask(
  args: Record<string, unknown>,
  _ctx: BoardToolContext,
): Promise<string> {
  const taskId = Number(args.task_id);
  if (!taskId || isNaN(taskId)) return "Error: task_id is required";
  const db = getDb();
  const existing = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!existing) return `Error: task ${taskId} not found`;
  const gitRow = db
    .query<{ worktree_status: string | null }, [number]>(
      "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
    )
    .get(taskId);
  if (gitRow?.worktree_status && gitRow.worktree_status !== "not_created") {
    return "Error: cannot edit task once a branch has been created";
  }
  const newTitle = (args.title != null ? (args.title as string).trim() : "") || existing.title;
  const newDesc = args.description !== undefined ? (args.description as string).trim() : existing.description;
  db.run("UPDATE tasks SET title = ?, description = ? WHERE id = ?", [newTitle, newDesc, taskId]);
  const updated = db.query<TaskRow, [number]>(TASK_WITH_GIT).get(taskId)!;
  return JSON.stringify(mapTask(updated));
}

// D5 fix: includes LSP registry cleanup (was missing in tools.ts version)
export async function execDeleteTask(
  args: Record<string, unknown>,
  ctx: BoardToolContext,
): Promise<string> {
  const taskId = Number(args.task_id);
  if (!taskId || isNaN(taskId)) return "Error: task_id is required";
  const db = getDb();
  const row = db
    .query<{ current_execution_id: number | null; conversation_id: number }, [number]>(
      "SELECT current_execution_id, conversation_id FROM tasks WHERE id = ?",
    )
    .get(taskId);
  if (!row) return `Error: task ${taskId} not found`;
  if (row.current_execution_id != null) {
    ctx.onCancel(row.current_execution_id);
  }
  try {
    await removeWorktree(taskId);
  } catch { /* deletion continues regardless */ }
  db.run("DELETE FROM task_hunk_decisions WHERE task_id = ?", [taskId]);
  db.run("DELETE FROM conversation_messages WHERE task_id = ?", [taskId]);
  db.run("DELETE FROM executions WHERE task_id = ?", [taskId]);
  db.run("DELETE FROM task_git_context WHERE task_id = ?", [taskId]);
  db.run("DELETE FROM pending_messages WHERE task_id = ?", [taskId]);
  db.run("DELETE FROM tasks WHERE id = ?", [taskId]);
  if (row.conversation_id) {
    db.run("DELETE FROM conversations WHERE id = ?", [row.conversation_id]);
  }
  taskLspRegistry.releaseTask(taskId).catch(() => { });
  return JSON.stringify({ success: true, deleted_task_id: taskId });
}

// D3 fix: enforce card limits + compute position (was silently skipped in common-tools.ts)
export async function execMoveTask(
  args: Record<string, unknown>,
  ctx: BoardToolContext,
): Promise<string> {
  const taskId = Number(args.task_id);
  if (!taskId || isNaN(taskId)) return "Error: task_id is required";
  const targetState = ((args.workflow_state as string) ?? "").trim();
  if (!targetState) return "Error: workflow_state is required";
  const db = getDb();
  const taskRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!taskRow) return `Error: task ${taskId} not found`;
  const boardRow = db
    .query<{ workflow_template_id: string }, [number]>(
      "SELECT workflow_template_id FROM boards WHERE id = ?",
    )
    .get(taskRow.board_id);
  const config = getConfig();
  const template = config.workflows.find((w) => w.id === boardRow?.workflow_template_id);
  const validColumn = template?.columns.find((c) => c.id === targetState);
  if (!validColumn) {
    const valid = template?.columns.map((c) => c.id).join(", ") ?? "(unknown)";
    return `Error: workflow_state "${targetState}" not found in board template. Valid columns: ${valid}`;
  }
  if (validColumn.limit != null) {
    const limitCountRow = db
      .query<{ count: number }, [number, string]>(
        "SELECT COUNT(*) as count FROM tasks WHERE board_id = ? AND workflow_state = ?",
      )
      .get(taskRow.board_id, targetState);
    if ((limitCountRow?.count ?? 0) >= validColumn.limit) {
      return `Error: column "${targetState}" is at capacity (${limitCountRow?.count}/${validColumn.limit}). Move a card out first.`;
    }
  }
  const minRow = db
    .query<{ min_pos: number | null }, [number, string]>(
      "SELECT MIN(position) as min_pos FROM tasks WHERE board_id = ? AND workflow_state = ?",
    )
    .get(taskRow.board_id, targetState);
  const topPos = minRow?.min_pos != null ? minRow.min_pos / 2 : 500;
  db.run("UPDATE tasks SET workflow_state = ?, position = ? WHERE id = ?", [targetState, topPos, taskId]);
  ctx.onTransition(taskId, targetState);
  return JSON.stringify({ success: true, task_id: taskId, workflow_state: targetState });
}

export async function execMessageTask(
  args: Record<string, unknown>,
  ctx: BoardToolContext,
): Promise<string> {
  const taskId = Number(args.task_id);
  if (!taskId || isNaN(taskId)) return "Error: task_id is required";
  const message = ((args.message as string) ?? "").trim();
  if (!message) return "Error: message is required";
  const db = getDb();
  const taskRow = db
    .query<{ execution_state: string }, [number]>(
      "SELECT execution_state FROM tasks WHERE id = ?",
    )
    .get(taskId);
  if (!taskRow) return `Error: task ${taskId} not found`;
  if (taskRow.execution_state === "running") {
    db.run("INSERT INTO pending_messages (task_id, content) VALUES (?, ?)", [taskId, message]);
    return JSON.stringify({ status: "queued", task_id: taskId });
  }
  ctx.onHumanTurn(taskId, message);
  return JSON.stringify({ status: "delivered", task_id: taskId });
}
