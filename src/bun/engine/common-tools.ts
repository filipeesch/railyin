/**
 * Common task-management tools shared across all engine implementations.
 *
 * These 8 tools (tasks_read + tasks_write groups) work identically regardless
 * of which AI engine is executing the agent loop. Each engine wraps them in
 * its own native tool registration format:
 *   - Native engine:  handled inside executeTool() in workflow/tools.ts
 *   - Copilot engine: wrapped with defineTool() in engine/copilot/tools.ts
 */

import type { AIToolDefinition } from "../ai/types.ts";
import type { CommonToolContext } from "./types.ts";
import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import type { TaskRow, ConversationMessageRow } from "../db/row-types.ts";
import { mapTask, mapConversationMessage } from "../db/mappers.ts";
import { removeWorktree } from "../git/worktree.ts";
import { getProjectById } from "../project-store.ts";
import { syncFileBackedCompatibilityState } from "../db/migrations.ts";

// ─── Tool definitions (metadata + JSON schema) ────────────────────────────────

export const COMMON_TOOL_DEFINITIONS: AIToolDefinition[] = [
  // ── tasks_read ───────────────────────────────────────────────────────────
  {
    name: "get_task",
    description:
      "Fetch metadata for a specific task by ID.\n\n" +
      "Usage:\n" +
      "- Returns title, description, workflow_state, execution_state, model, branch, worktree path, execution count\n" +
      "- Use include_messages=N for the last N conversation messages in chronological order\n" +
      "- Returns metadata only — use read_file to inspect files in the task's worktree",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to fetch." },
        include_messages: { type: "number", description: "If provided, include the last N conversation messages in chronological order." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_board_summary",
    description:
      "Return a high-level summary of task distribution across board columns.\n\n" +
      "Usage:\n" +
      "- Shows total count and breakdown by execution_state (idle, running, completed, failed) per column\n" +
      "- Omit board_id to summarise the current task's board\n" +
      "- Use to get an overview before listing individual tasks",
    parameters: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "The board to summarise. Defaults to the current task's board when omitted." },
      },
      required: [],
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks on a board with optional filters.\n\n" +
      "Usage:\n" +
      "- Filter by workflow_state, execution_state, project_id\n" +
      "- Use query for case-insensitive text search across title and description\n" +
      "- Omit board_id to search the current task's board; default limit 50 (max 200)",
    parameters: {
      type: "object",
      properties: {
        board_id: { type: "number", description: "Board to list tasks from. Defaults to the current task's board." },
        workflow_state: { type: "string", description: "Filter by exact workflow column id (e.g. 'backlog', 'in-progress')." },
        execution_state: { type: "string", description: "Filter by execution state (e.g. 'idle', 'running', 'failed')." },
        project_id: { type: "number", description: "Filter tasks belonging to a specific project." },
        query: { type: "string", description: "Case-insensitive substring search across title and description." },
        limit: { type: "number", description: "Maximum number of results to return (default 50, max 200)." },
      },
      required: [],
    },
  },
  // ── tasks_write ──────────────────────────────────────────────────────────
  {
    name: "create_task",
    description:
      "Create a new task in the backlog column of a board.\n\n" +
      "Usage:\n" +
      "- Starts in 'idle' execution state; use move_task to start it\n" +
      "- Omit board_id to create on the current task's board\n" +
      "- Use model parameter to override the default model for this task",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "number", description: "The project this task belongs to." },
        title: { type: "string", description: "The task title." },
        description: { type: "string", description: "The task description." },
        board_id: { type: "number", description: "Board to create the task on. Defaults to the current task's board." },
        model: { type: "string", description: "Optional model override for this task (e.g. 'lmstudio/qwen3-8b')." },
      },
      required: ["project_id", "title", "description"],
    },
  },
  {
    name: "edit_task",
    description:
      "Update the title and/or description of a task.\n\n" +
      "Usage:\n" +
      "- Only allowed before a worktree/branch has been created\n" +
      "- At least one of title or description must be provided",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to edit." },
        title: { type: "string", description: "New title for the task." },
        description: { type: "string", description: "New description for the task." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "delete_task",
    description:
      "Fully delete a task and all its data including conversation history, executions, and worktree.\n\n" +
      "Usage:\n" +
      "- Git branch is preserved; only task data is removed\n" +
      "- Running tasks are cancelled first; this action is permanent and cannot be undone",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to delete." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "move_task",
    description:
      "Move a task to a different workflow column.\n\n" +
      "Usage:\n" +
      "- workflow_state is updated immediately\n" +
      "- If the target column has an on_enter_prompt, it is triggered asynchronously\n" +
      "- Returns immediately without waiting for triggered execution to complete",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to move." },
        workflow_state: { type: "string", description: "The target column id (e.g. 'backlog', 'in-progress', 'done')." },
      },
      required: ["task_id", "workflow_state"],
    },
  },
  {
    name: "message_task",
    description:
      "Append a message to another task's conversation and trigger its AI model.\n\n" +
      "Usage:\n" +
      "- Returns 'delivered' (idle/waiting) or 'queued' (running — delivered when execution finishes)\n" +
      "- Use for inter-task communication: sending results, requesting actions",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The id of the task to message." },
        message: { type: "string", description: "The message content to send." },
      },
      required: ["task_id", "message"],
    },
  },
];

export const COMMON_TOOL_NAMES = new Set(COMMON_TOOL_DEFINITIONS.map((t) => t.name));

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Execute a common task-management tool by name.
 * Returns a plain JSON/text string suitable for sending back to the LLM.
 */
export async function executeCommonTool(
  name: string,
  args: Record<string, string>,
  ctx: CommonToolContext,
): Promise<string> {
  switch (name) {
    case "get_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
      if (!taskId || isNaN(taskId)) return "Error: task_id is required";
      const db = getDb();
      const row = db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.id = ?`,
        )
        .get(taskId);
      if (!row) return `Error: task ${taskId} not found`;
      const task = mapTask(row);
      const includeN = args.include_messages ? parseInt(args.include_messages, 10) : 0;
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

    case "get_board_summary": {
      const db = getDb();
      const boardId = args.board_id ? parseInt(args.board_id, 10) : (ctx.boardId ?? 0);
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
        columns[r.workflow_state].by_state[r.execution_state] = (columns[r.workflow_state].by_state[r.execution_state] ?? 0) + r.count;
      }
      return JSON.stringify({ board_id: boardId, columns });
    }

    case "list_tasks": {
      const db = getDb();
      const boardId = args.board_id ? parseInt(args.board_id, 10) : (ctx.boardId ?? 0);
      if (!boardId) return "Error: board_id is required (or run this tool from a task on a board)";
      const limitRaw = args.limit ? parseInt(args.limit, 10) : 50;
      const limit = Math.min(Math.max(1, limitRaw), 200);
      const conditions: string[] = ["t.board_id = ?"];
      const params: (string | number)[] = [boardId];
      if (args.workflow_state) { conditions.push("t.workflow_state = ?"); params.push(args.workflow_state); }
      if (args.execution_state) { conditions.push("t.execution_state = ?"); params.push(args.execution_state); }
      if (args.project_id) { conditions.push("t.project_id = ?"); params.push(parseInt(args.project_id, 10)); }
      if (args.query) {
        conditions.push("(t.title LIKE ? OR t.description LIKE ?)");
        const q = `%${args.query}%`;
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

    case "create_task": {
      const projectId = args.project_id ? parseInt(args.project_id, 10) : NaN;
      if (!projectId || isNaN(projectId)) return "Error: project_id is required";
      const title = (args.title ?? "").trim();
      if (!title) return "Error: title is required";
      const description = (args.description ?? "").trim();
      const boardId = args.board_id ? parseInt(args.board_id, 10) : (ctx.boardId ?? 0);
      if (!boardId) return "Error: board_id is required (or run this tool from a task on a board)";
      syncFileBackedCompatibilityState();
      const db = getDb();
      const boardRow = db.query<{ id: number }, [number]>("SELECT id FROM boards WHERE id = ?").get(boardId);
      if (!boardRow) return `Error: board ${boardId} not found`;
      const project = getProjectById(projectId);
      if (!project) return `Error: project ${projectId} not found`;
      const convRes = db.run("INSERT INTO conversations (task_id) VALUES (0)");
      const convId = convRes.lastInsertRowid as number;
      const effectiveModel = args.model || getConfig()?.workspace.default_model || null;
      const taskRes = db.run(
        `INSERT INTO tasks (board_id, project_id, title, description, workflow_state, execution_state, conversation_id${effectiveModel ? ", model" : ""})
         VALUES (?, ?, ?, ?, 'backlog', 'idle', ?${effectiveModel ? ", ?" : ""})`,
        effectiveModel
          ? [boardId, projectId, title, description, convId, effectiveModel]
          : [boardId, projectId, title, description, convId],
      );
      const newTaskId = taskRes.lastInsertRowid as number;
      db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [newTaskId, convId]);
      const newRow = db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.id = ?`,
        )
        .get(newTaskId)!;
      return JSON.stringify(mapTask(newRow));
    }

    case "edit_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
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
      const newTitle = (args.title ?? "").trim() || existing.title;
      const newDesc = args.description !== undefined ? args.description.trim() : existing.description;
      db.run("UPDATE tasks SET title = ?, description = ? WHERE id = ?", [newTitle, newDesc, taskId]);
      const updated = db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.id = ?`,
        )
        .get(taskId)!;
      return JSON.stringify(mapTask(updated));
    }

    case "delete_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
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
      db.run("DELETE FROM conversation_messages WHERE task_id = ?", [taskId]);
      db.run("DELETE FROM executions WHERE task_id = ?", [taskId]);
      db.run("DELETE FROM task_git_context WHERE task_id = ?", [taskId]);
      db.run("DELETE FROM pending_messages WHERE task_id = ?", [taskId]);
      db.run("DELETE FROM tasks WHERE id = ?", [taskId]);
      if (row.conversation_id) {
        db.run("DELETE FROM conversations WHERE id = ?", [row.conversation_id]);
      }
      return JSON.stringify({ success: true, deleted_task_id: taskId });
    }

    case "move_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
      if (!taskId || isNaN(taskId)) return "Error: task_id is required";
      const targetState = (args.workflow_state ?? "").trim();
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
      db.run("UPDATE tasks SET workflow_state = ? WHERE id = ?", [targetState, taskId]);
      ctx.onTransition(taskId, targetState);
      return JSON.stringify({ success: true, task_id: taskId, workflow_state: targetState });
    }

    case "message_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
      if (!taskId || isNaN(taskId)) return "Error: task_id is required";
      const message = (args.message ?? "").trim();
      if (!message) return "Error: message is required";
      const db = getDb();
      const taskRow = db
        .query<{ execution_state: string }, [number]>(
          "SELECT execution_state FROM tasks WHERE id = ?",
        )
        .get(taskId);
      if (!taskRow) return `Error: task ${taskId} not found`;
      if (taskRow.execution_state === "running") {
        db.run(
          "INSERT INTO pending_messages (task_id, content) VALUES (?, ?)",
          [taskId, message],
        );
        return JSON.stringify({ status: "queued", task_id: taskId });
      }
      ctx.onHumanTurn(taskId, message);
      return JSON.stringify({ status: "delivered", task_id: taskId });
    }

    default:
      return `Error: unknown common tool "${name}"`;
  }
}
