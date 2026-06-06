import type { Database } from "bun:sqlite";
import type { IWorkspaceRepository } from "../../db/workspace-repository.ts";
import type { TaskRow, ConversationMessageRow } from "../../db/row-types.ts";
import { mapTask, mapConversationMessage } from "../../db/mappers.ts";
import type { WorktreeManager } from "../../git/WorktreeManager.ts";
import { getProjectByKey, getLoadedProjectByKey } from "../../project-store.ts";
import { taskLspRegistry } from "../../lsp/task-registry.ts";
import { PositionService } from "../../handlers/position-service.ts";
import type { BoardToolContext } from "./types.ts";
import { validateTransition } from "../transition-validator.ts";
import { getWorkspaceConfig } from "../../workspace-context.ts";
import { getColumnConfig } from "../column-config.ts";

export interface IBoardToolExecutor {
  execGetTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string>;
  execGetBoardSummary(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string>;
  execListTasks(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string>;
  execCreateTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string>;
  execEditTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string>;
  execDeleteTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string>;
  execMoveTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string>;
  execMessageTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string>;
  execListBoards(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string>;
}

const TASK_WITH_GIT = `
  SELECT t.*,
         gc.worktree_status, gc.branch_name, gc.worktree_path,
         c.model AS conversation_model,
         (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
  FROM tasks t
  LEFT JOIN task_git_context gc ON gc.task_id = t.id
  LEFT JOIN conversations c ON c.id = t.conversation_id
  WHERE t.id = ?`;

export class BoardToolExecutor implements IBoardToolExecutor {
  private readonly positionService: PositionService;

  constructor(
    private readonly db: Database,
    private readonly wsRepo: IWorkspaceRepository,
    private readonly worktreeManager?: WorktreeManager,
  ) {
    this.positionService = new PositionService(db);
  }

  async execGetTask(args: Record<string, unknown>, _ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const row = this.db.query<TaskRow, [number]>(TASK_WITH_GIT).get(taskId);
    if (!row) return `Error: task ${taskId} not found`;
    const task = mapTask(row);
    const includeN = args.include_messages != null ? Number(args.include_messages) : 0;
    if (includeN > 0) {
      const msgs = this.db
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

  async execGetBoardSummary(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const boardId = args.board_id != null ? Number(args.board_id) : (ctx.boardId ?? 0);
    if (!boardId) return "Error: board_id is required. Use list_boards to discover available boards.";
    const boardRow = this.db
      .query<{ id: number }, [number]>("SELECT id FROM boards WHERE id = ?")
      .get(boardId);
    if (!boardRow) return `Error: board ${boardId} not found`;
    const rows = this.db
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

  async execListTasks(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const boardId = args.board_id != null ? Number(args.board_id) : (ctx.boardId ?? 0);
    if (!boardId) return "Error: board_id is required. Use list_boards to discover available boards.";
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
    const rows = this.db.query<TaskRow, typeof params>(sql).all(...params);
    return JSON.stringify(rows.map(mapTask));
  }

  async execCreateTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const projectKey = ((args.project_key as string) ?? "").trim();
    if (!projectKey) return "Error: project_key is required";
    const title = ((args.title as string) ?? "").trim();
    if (!title) return "Error: title is required";
    const description = ((args.description as string) ?? "").trim();
    const boardId = args.board_id != null ? Number(args.board_id) : (ctx.boardId ?? 0);
    if (!boardId) return "Error: board_id is required. Use list_boards to discover available boards.";
    const boardRow = this.db
      .query<{ id: number; workspace_key: string }, [number]>(
        "SELECT id, workspace_key FROM boards WHERE id = ?",
      )
      .get(boardId);
    if (!boardRow) return `Error: board ${boardId} not found`;
    const project = getProjectByKey(boardRow.workspace_key, projectKey);
    if (!project) return `Error: project ${projectKey} not found`;
    const convRes = this.db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const convId = convRes.lastInsertRowid as number;
    const explicitModel = args.model as string;
    if (explicitModel) {
      this.db.run("UPDATE conversations SET model = ? WHERE id = ?", [explicitModel, convId]);
    }
    const topPosition = this.positionService.getTopPosition(boardId, "backlog");
    const taskRes = this.db.run(
      `INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position)
       VALUES (?, ?, ?, ?, 'backlog', 'idle', ?, ?)`,
      [boardId, projectKey, title, description, convId, topPosition],
    );
    const newTaskId = taskRes.lastInsertRowid as number;
    this.db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [newTaskId, convId]);
    const newRow = this.db.query<TaskRow, [number]>(TASK_WITH_GIT).get(newTaskId)!;
    ctx.onTaskUpdated(mapTask(newRow));
    return JSON.stringify(mapTask(newRow));
  }

  async execEditTask(args: Record<string, unknown>, _ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const existing = this.db
      .query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?")
      .get(taskId);
    if (!existing) return `Error: task ${taskId} not found`;
    const gitRow = this.db
      .query<{ worktree_status: string | null }, [number]>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    if (gitRow?.worktree_status && gitRow.worktree_status !== "not_created") {
      return "Error: cannot edit task once a branch has been created";
    }
    const newTitle = (args.title != null ? (args.title as string).trim() : "") || existing.title;
    const newDesc =
      args.description !== undefined
        ? (args.description as string).trim()
        : existing.description;
    this.db.run("UPDATE tasks SET title = ?, description = ? WHERE id = ?", [
      newTitle,
      newDesc,
      taskId,
    ]);
    const updated = this.db.query<TaskRow, [number]>(TASK_WITH_GIT).get(taskId)!;
    return JSON.stringify(mapTask(updated));
  }

  async execDeleteTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const row = this.db
      .query<{ current_execution_id: number | null; conversation_id: number }, [number]>(
        "SELECT current_execution_id, conversation_id FROM tasks WHERE id = ?",
      )
      .get(taskId);
    if (!row) return `Error: task ${taskId} not found`;
    if (row.current_execution_id != null) {
      ctx.onCancel(row.current_execution_id);
    }
    try {
      await this.worktreeManager?.removeWorktree(taskId);
    } catch { /* deletion continues regardless */ }
    this.db.run("DELETE FROM task_hunk_decisions WHERE task_id = ?", [taskId]);
    this.db.run("DELETE FROM conversation_messages WHERE task_id = ?", [taskId]);
    this.db.run("DELETE FROM executions WHERE task_id = ?", [taskId]);
    this.db.run("DELETE FROM task_git_context WHERE task_id = ?", [taskId]);
    this.db.run("DELETE FROM pending_messages WHERE task_id = ?", [taskId]);
    this.db.run("DELETE FROM tasks WHERE id = ?", [taskId]);
    if (row.conversation_id) {
      this.db.run("DELETE FROM conversations WHERE id = ?", [row.conversation_id]);
    }
    taskLspRegistry.releaseTask(taskId).catch(() => {});
    return JSON.stringify({ success: true, deleted_task_id: taskId });
  }

  async execMoveTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const targetState = ((args.workflow_state as string) ?? "").trim();
    if (!targetState) return "Error: workflow_state is required";

    const validation = validateTransition(this.db, taskId, targetState);
    if (!validation.ok) {
      return `Error: ${validation.reason}`;
    }
    const topPos = this.positionService.getTopPosition(validation.boardId, targetState);

    const movedTask = this.db
      .query<{ execution_state: string }, [number]>(
        "SELECT execution_state FROM tasks WHERE id = ?",
      )
      .get(taskId)!;
    const wsKey = this.wsRepo.getBoardWorkspaceKey(validation.boardId);
    const config = getWorkspaceConfig(wsKey);
    const targetCol = getColumnConfig(config, validation.boardId, targetState);

    const isSelf = taskId === ctx.taskId;
    const isRunning = movedTask.execution_state === "running";
    const hasPrompt = !!targetCol?.on_enter_prompt;

    this.db.run("UPDATE tasks SET workflow_state = ?, position = ? WHERE id = ?", [
      targetState,
      topPos,
      taskId,
    ]);

    if ((isSelf || isRunning) && hasPrompt) {
      this.db.run("UPDATE tasks SET needs_column_prompt = 1 WHERE id = ?", [taskId]);
    } else if (!isSelf && !isRunning && hasPrompt) {
      ctx.onTransition(taskId, targetState);
    }

    const updatedRow = this.db.query<TaskRow, [number]>(TASK_WITH_GIT).get(taskId)!;
    ctx.onTaskUpdated(mapTask(updatedRow));
    return JSON.stringify({ success: true, task_id: taskId, workflow_state: targetState });
  }

  async execMessageTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const message = ((args.message as string) ?? "").trim();
    if (!message) return "Error: message is required";
    const taskRow = this.db
      .query<{ execution_state: string }, [number]>(
        "SELECT execution_state FROM tasks WHERE id = ?",
      )
      .get(taskId);
    if (!taskRow) return `Error: task ${taskId} not found`;
    if (taskRow.execution_state === "running") {
      this.db.run("INSERT INTO pending_messages (task_id, content) VALUES (?, ?)", [
        taskId,
        message,
      ]);
      return JSON.stringify({ status: "queued", task_id: taskId });
    }
    ctx.onHumanTurn(taskId, message);
    return JSON.stringify({ status: "delivered", task_id: taskId });
  }

  async execListBoards(_args: Record<string, unknown>, _ctx: BoardToolContext): Promise<string> {
    const rows = this.db
      .query<{ id: number; name: string }, []>("SELECT id, name FROM boards ORDER BY created_at ASC")
      .all();
    return JSON.stringify(rows);
  }
}
