import type { Db } from "../../db/db.ts";
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
  WHERE t.id = $1`;

export class BoardToolExecutor implements IBoardToolExecutor {
  private readonly positionService: PositionService;

  constructor(
    private readonly db: Db,
    private readonly wsRepo: IWorkspaceRepository,
    private readonly worktreeManager?: WorktreeManager,
  ) {
    this.positionService = new PositionService(db);
  }

  async execGetTask(args: Record<string, unknown>, _ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const row = await this.db.get<TaskRow>(TASK_WITH_GIT, [taskId]);
    if (!row) return `Error: task ${taskId} not found`;
    const task = mapTask(row);
    const includeN = args.include_messages != null ? Number(args.include_messages) : 0;
    if (includeN > 0) {
      const msgs = (await this.db.rows<ConversationMessageRow>(
        `SELECT * FROM conversation_messages WHERE task_id = $1 ORDER BY id DESC LIMIT $2`,
        [taskId, includeN],
      ))
        .reverse()
        .map(mapConversationMessage);
      return JSON.stringify({ task, messages: msgs });
    }
    return JSON.stringify(task);
  }

  async execGetBoardSummary(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const boardId = args.board_id != null ? Number(args.board_id) : (ctx.boardId ?? 0);
    if (!boardId) return "Error: board_id is required. Use list_boards to discover available boards.";
    const boardRow = await this.db.get<{ id: number }>("SELECT id FROM boards WHERE id = $1", [boardId]);
    if (!boardRow) return `Error: board ${boardId} not found`;
    const rows = await this.db.rows<{ workflow_state: string; execution_state: string; count: number }>(
      `SELECT workflow_state, execution_state, COUNT(*) as count
         FROM tasks WHERE board_id = $1
         GROUP BY workflow_state, execution_state`,
      [boardId],
    );
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
    const params: (string | number)[] = [boardId];
    const conditions: string[] = ["t.board_id = $1"];
    if (args.workflow_state) { params.push(args.workflow_state as string); conditions.push(`t.workflow_state = $${params.length}`); }
    if (args.execution_state) { params.push(args.execution_state as string); conditions.push(`t.execution_state = $${params.length}`); }
    if (args.project_key) { params.push(args.project_key as string); conditions.push(`t.project_key = $${params.length}`); }
    if (args.query) {
      const q = `%${args.query as string}%`;
      params.push(q);
      const titlePh = params.length;
      params.push(q);
      const descPh = params.length;
      conditions.push(`(t.title LIKE $${titlePh} OR t.description LIKE $${descPh})`);
    }
    params.push(limit);
    const limitPh = params.length;
    const sql = `SELECT t.*,
                        gc.worktree_status, gc.branch_name, gc.worktree_path,
                        (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
                 FROM tasks t
                 LEFT JOIN task_git_context gc ON gc.task_id = t.id
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY t.created_at ASC LIMIT $${limitPh}`;
    const rows = await this.db.rows<TaskRow>(sql, params);
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
    const boardRow = await this.db.get<{ id: number; workspace_key: string }>(
      "SELECT id, workspace_key FROM boards WHERE id = $1",
      [boardId],
    );
    if (!boardRow) return `Error: board ${boardId} not found`;
    const project = getProjectByKey(boardRow.workspace_key, projectKey);
    if (!project) return `Error: project ${projectKey} not found`;
    const convRes = await this.db.exec("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
    const convId = (convRes.rows[0] as { id: number }).id;
    const explicitModel = args.model as string;
    if (explicitModel) {
      await this.db.exec("UPDATE conversations SET model = $1 WHERE id = $2", [explicitModel, convId]);
    }
    const topPosition = await this.positionService.getTopPosition(boardId, "backlog");
    const taskRes = await this.db.exec(
      `INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, position)
       VALUES ($1, $2, $3, $4, 'backlog', 'idle', $5, $6) RETURNING id`,
      [boardId, projectKey, title, description, convId, topPosition],
    );
    const newTaskId = (taskRes.rows[0] as { id: number }).id;
    await this.db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [newTaskId, convId]);
    const newRow = (await this.db.get<TaskRow>(TASK_WITH_GIT, [newTaskId]))!;
    ctx.onTaskUpdated(mapTask(newRow));
    return JSON.stringify(mapTask(newRow));
  }

  async execEditTask(args: Record<string, unknown>, _ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const existing = await this.db.get<TaskRow>("SELECT * FROM tasks WHERE id = $1", [taskId]);
    if (!existing) return `Error: task ${taskId} not found`;
    const gitRow = await this.db.get<{ worktree_status: string | null }>(
      "SELECT worktree_status FROM task_git_context WHERE task_id = $1",
      [taskId],
    );
    if (gitRow?.worktree_status && gitRow.worktree_status !== "not_created") {
      return "Error: cannot edit task once a branch has been created";
    }
    const newTitle = (args.title != null ? (args.title as string).trim() : "") || existing.title;
    const newDesc =
      args.description !== undefined
        ? (args.description as string).trim()
        : existing.description;
    await this.db.exec("UPDATE tasks SET title = $1, description = $2 WHERE id = $3", [
      newTitle,
      newDesc,
      taskId,
    ]);
    const updated = (await this.db.get<TaskRow>(TASK_WITH_GIT, [taskId]))!;
    return JSON.stringify(mapTask(updated));
  }

  async execDeleteTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const row = await this.db.get<{ current_execution_id: number | null; conversation_id: number }>(
      "SELECT current_execution_id, conversation_id FROM tasks WHERE id = $1",
      [taskId],
    );
    if (!row) return `Error: task ${taskId} not found`;
    if (row.current_execution_id != null) {
      ctx.onCancel(row.current_execution_id);
    }
    try {
      await this.worktreeManager?.removeWorktree(taskId);
    } catch { /* deletion continues regardless */ }
    await this.db.exec("DELETE FROM task_hunk_decisions WHERE task_id = $1", [taskId]);
    await this.db.exec("DELETE FROM conversation_messages WHERE task_id = $1", [taskId]);
    await this.db.exec("DELETE FROM executions WHERE task_id = $1", [taskId]);
    await this.db.exec("DELETE FROM task_git_context WHERE task_id = $1", [taskId]);
    await this.db.exec("DELETE FROM pending_messages WHERE task_id = $1", [taskId]);
    await this.db.exec("DELETE FROM tasks WHERE id = $1", [taskId]);
    if (row.conversation_id) {
      await this.db.exec("DELETE FROM conversations WHERE id = $1", [row.conversation_id]);
    }
    taskLspRegistry.releaseTask(taskId).catch(() => {});
    return JSON.stringify({ success: true, deleted_task_id: taskId });
  }

  async execMoveTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const targetState = ((args.workflow_state as string) ?? "").trim();
    if (!targetState) return "Error: workflow_state is required";

    const validation = await validateTransition(this.db, taskId, targetState);
    if (!validation.ok) {
      return `Error: ${validation.reason}`;
    }
    const topPos = await this.positionService.getTopPosition(validation.boardId, targetState);

    const movedTask = (await this.db.get<{ execution_state: string }>(
      "SELECT execution_state FROM tasks WHERE id = $1",
      [taskId],
    ))!;
    const wsKey = await this.wsRepo.getBoardWorkspaceKey(validation.boardId);
    const config = getWorkspaceConfig(wsKey);
    const targetCol = await getColumnConfig(config, validation.boardId, targetState);

    const isSelf = taskId === ctx.taskId;
    const isRunning = movedTask.execution_state === "running";
    const hasPrompt = !!targetCol?.on_enter_prompt;

    await this.db.exec("UPDATE tasks SET workflow_state = $1, position = $2 WHERE id = $3", [
      targetState,
      topPos,
      taskId,
    ]);

    if ((isSelf || isRunning) && hasPrompt) {
      await this.db.exec("UPDATE tasks SET needs_column_prompt = 1 WHERE id = $1", [taskId]);
    } else if (!isSelf && !isRunning && hasPrompt) {
      ctx.onTransition(taskId, targetState);
    }

    const updatedRow = (await this.db.get<TaskRow>(TASK_WITH_GIT, [taskId]))!;
    ctx.onTaskUpdated(mapTask(updatedRow));
    return JSON.stringify({ success: true, task_id: taskId, workflow_state: targetState });
  }

  async execMessageTask(args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const taskId = Number(args.task_id);
    if (!taskId || isNaN(taskId)) return "Error: task_id is required";
    const message = ((args.message as string) ?? "").trim();
    if (!message) return "Error: message is required";
    const taskRow = await this.db.get<{ execution_state: string }>(
      "SELECT execution_state FROM tasks WHERE id = $1",
      [taskId],
    );
    if (!taskRow) return `Error: task ${taskId} not found`;
    if (taskRow.execution_state === "running") {
      await this.db.exec("INSERT INTO pending_messages (task_id, content) VALUES ($1, $2)", [
        taskId,
        message,
      ]);
      return JSON.stringify({ status: "queued", task_id: taskId });
    }
    ctx.onHumanTurn(taskId, message);
    return JSON.stringify({ status: "delivered", task_id: taskId });
  }

  async execListBoards(_args: Record<string, unknown>, ctx: BoardToolContext): Promise<string> {
    const rows = await this.db.rows<{ id: number; name: string }>(
      "SELECT id, name FROM boards WHERE workspace_key = $1 ORDER BY created_at ASC",
      [ctx.workspaceKey],
    );
    return JSON.stringify(rows);
  }
}
