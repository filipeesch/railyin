import { getDb } from "../db/index.ts";
import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";
import type { TaskRow } from "../db/row-types.ts";
import { mapTask } from "../db/mappers.ts";
import {
  handleTransition,
  handleHumanTurn,
  handleRetry,
  appendMessage,
  estimateContextWarning,
  cancelExecution,
} from "../workflow/engine.ts";
import { triggerWorktreeIfNeeded, registerProjectGitContext, removeWorktree } from "../git/worktree.ts";
import type { ProjectRow } from "../db/row-types.ts";
import type { OnToken, OnError, OnTaskUpdated } from "../workflow/engine.ts";
import { getConfig } from "../config/index.ts";

// ─── Helper: fetch a single task with git context + execution count ───────────

function fetchTaskWithDetail(db: ReturnType<typeof getDb>, taskId: number): Task | null {
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
  return row ? mapTask(row) : null;
}

export function taskHandlers(onToken: OnToken, onError: OnError, onTaskUpdated: OnTaskUpdated) {
  return {
    "tasks.list": async (params: { boardId: number }): Promise<Task[]> => {
      const db = getDb();
      return db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.board_id = ?
           ORDER BY t.created_at ASC`,
        )
        .all(params.boardId)
        .map(mapTask);
    },

    "tasks.create": async (params: {
      boardId: number;
      projectId: number;
      title: string;
      description: string;
    }): Promise<Task> => {
      const db = getDb();

      // Create conversation first with placeholder task_id=0
      const convResult = db.run("INSERT INTO conversations (task_id) VALUES (0)");
      const conversationId = convResult.lastInsertRowid as number;

      const taskResult = db.run(
        `INSERT INTO tasks
           (board_id, project_id, title, description, workflow_state, execution_state, conversation_id)
         VALUES (?, ?, ?, ?, 'backlog', 'idle', ?)`,
        [
          params.boardId,
          params.projectId,
          params.title.trim(),
          params.description.trim(),
          conversationId,
        ],
      );
      const taskId = taskResult.lastInsertRowid as number;

      // Fix up conversation → task link
      db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);

      // Register git context for this task so tool calling works (best-effort)
      try {
        const project = db
          .query<Pick<ProjectRow, "git_root_path">, [number]>(
            "SELECT git_root_path FROM projects WHERE id = ?",
          )
          .get(params.projectId);
        if (project?.git_root_path) {
          registerProjectGitContext(taskId, project.git_root_path);
        }
      } catch (err) {
        console.warn("[railyn] failed to register git context for task", taskId, err);
      }

      // Seed conversation with task description as first system message
      appendMessage(
        taskId,
        conversationId,
        "system",
        null,
        `Task: ${params.title}\n\n${params.description}`,
      );

      const row = db
        .query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?")
        .get(taskId)!;

      return mapTask(row);
    },

    "tasks.transition": async (params: {
      taskId: number;
      toState: string;
    }): Promise<{ task: Task; executionId: number | null }> => {
      const db = getDb();

      const taskRow = db
        .query<{ project_id: number; conversation_id: number }, [number]>(
          "SELECT project_id, conversation_id FROM tasks WHERE id = ?",
        )
        .get(params.taskId);

      if (taskRow) {
        // Backfill git context for tasks created before this was wired up
        const project = db
          .query<Pick<ProjectRow, "git_root_path">, [number]>(
            "SELECT git_root_path FROM projects WHERE id = ?",
          )
          .get(taskRow.project_id);
        if (project?.git_root_path) {
          registerProjectGitContext(params.taskId, project.git_root_path);
        }

        const postStatus = (msg: string) => {
          appendMessage(params.taskId, taskRow.conversation_id, "system", null, msg);
          const updated = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId);
          if (updated) onTaskUpdated(mapTask(updated));
        };

        try {
          await triggerWorktreeIfNeeded(params.taskId, postStatus);
        } catch (err) {
          // Worktree is required — fail the task so the user sees the error in the UI
          const errMsg = err instanceof Error ? err.message : String(err);
          db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [params.taskId]);
          appendMessage(
            params.taskId,
            taskRow.conversation_id,
            "system",
            null,
            `Worktree setup failed: ${errMsg}`,
          );
          const failedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId)!;
          onTaskUpdated(mapTask(failedRow));
          return { task: mapTask(failedRow), executionId: null };
        }
      }

      return handleTransition(params.taskId, params.toState, onToken, onError, onTaskUpdated);
    },

    "tasks.sendMessage": async (params: {
      taskId: number;
      content: string;
    }): Promise<{ message: ConversationMessage; executionId: number }> => {
      const warning = estimateContextWarning(params.taskId);
      if (warning) {
        console.warn(`[railyn] context warning for task ${params.taskId}: ${warning}`);
      }
      return handleHumanTurn(params.taskId, params.content, onToken, onError, onTaskUpdated);
    },

    "tasks.retry": async (params: {
      taskId: number;
    }): Promise<{ task: Task; executionId: number }> => {
      const db = getDb();

      // Retry worktree setup if it previously failed — same logic as tasks.transition
      const taskRow = db
        .query<{ project_id: number; conversation_id: number }, [number]>(
          "SELECT project_id, conversation_id FROM tasks WHERE id = ?",
        )
        .get(params.taskId);

      if (taskRow) {
        const project = db
          .query<Pick<ProjectRow, "git_root_path">, [number]>(
            "SELECT git_root_path FROM projects WHERE id = ?",
          )
          .get(taskRow.project_id);
        if (project?.git_root_path) {
          registerProjectGitContext(params.taskId, project.git_root_path);
        }

        const postStatus = (msg: string) => {
          appendMessage(params.taskId, taskRow.conversation_id, "system", null, msg);
          const updated = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId);
          if (updated) onTaskUpdated(mapTask(updated));
        };

        try {
          await triggerWorktreeIfNeeded(params.taskId, postStatus);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [params.taskId]);
          appendMessage(params.taskId, taskRow.conversation_id, "system", null, `Worktree setup failed: ${errMsg}`);
          const failedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId)!;
          onTaskUpdated(mapTask(failedRow));
          // Return a fake execution id of -1 since we can't proceed — caller won't use it
          return { task: mapTask(failedRow), executionId: -1 };
        }
      }

      return handleRetry(params.taskId, onToken, onError, onTaskUpdated);
    },

    // ─── models.list ─────────────────────────────────────────────────────────
    "models.list": async (): Promise<string[]> => {
      const config = getConfig();
      const { base_url, api_key } = config.workspace.ai;
      try {
        const res = await fetch(`${base_url}/v1/models`, {
          headers: api_key ? { Authorization: `Bearer ${api_key}` } : {},
        });
        if (!res.ok) return [];
        const json = await res.json() as { data?: Array<{ id: string }> };
        return (json.data ?? []).map((m) => m.id).filter(Boolean);
      } catch {
        return [];
      }
    },

    // ─── tasks.setModel ──────────────────────────────────────────────────────
    "tasks.setModel": async (params: { taskId: number; model: string | null }): Promise<Task> => {
      const db = getDb();
      db.run("UPDATE tasks SET model = ? WHERE id = ?", [params.model, params.taskId]);
      const task = fetchTaskWithDetail(db, params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      return task;
    },

    // ─── tasks.cancel ────────────────────────────────────────────────────────
    "tasks.cancel": async (params: { taskId: number }): Promise<Task> => {
      const db = getDb();
      const row = db
        .query<{ current_execution_id: number | null }, [number]>(
          "SELECT current_execution_id FROM tasks WHERE id = ?",
        )
        .get(params.taskId);
      if (row?.current_execution_id != null) {
        cancelExecution(row.current_execution_id);
      }
      const task = fetchTaskWithDetail(db, params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      return task;
    },

    // ─── tasks.update ────────────────────────────────────────────────────────
    "tasks.update": async (params: { taskId: number; title: string; description: string }): Promise<Task> => {
      const db = getDb();
      const gitRow = db
        .query<{ worktree_status: string | null }, [number]>(
          "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (gitRow && gitRow.worktree_status && gitRow.worktree_status !== "not_created") {
        throw new Error("Cannot edit task once a worktree has been created");
      }
      db.run(
        "UPDATE tasks SET title = ?, description = ? WHERE id = ?",
        [params.title.trim(), params.description.trim(), params.taskId],
      );
      const task = fetchTaskWithDetail(db, params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      return task;
    },

    // ─── tasks.delete ────────────────────────────────────────────────────────
    "tasks.delete": async (params: { taskId: number }): Promise<{ success: boolean }> => {
      const db = getDb();

      // Cancel any running execution first
      const row = db
        .query<{ current_execution_id: number | null; conversation_id: number }, [number]>(
          "SELECT current_execution_id, conversation_id FROM tasks WHERE id = ?",
        )
        .get(params.taskId);
      if (row?.current_execution_id != null) {
        cancelExecution(row.current_execution_id);
      }

      // Remove worktree (no-op if not created)
      await removeWorktree(params.taskId);

      // Cascade delete
      db.run("DELETE FROM conversation_messages WHERE task_id = ?", [params.taskId]);
      db.run("DELETE FROM executions WHERE task_id = ?", [params.taskId]);
      db.run("DELETE FROM task_git_context WHERE task_id = ?", [params.taskId]);
      if (row?.conversation_id) {
        db.run("DELETE FROM conversations WHERE id = ?", [row.conversation_id]);
      }
      db.run("DELETE FROM tasks WHERE id = ?", [params.taskId]);

      return { success: true };
    },

    // ─── tasks.getGitStat ────────────────────────────────────────────────────
    "tasks.getGitStat": async (params: { taskId: number }): Promise<string | null> => {
      const db = getDb();
      const gitRow = db
        .query<{ worktree_path: string | null; worktree_status: string | null }, [number]>(
          "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
        )
        .get(params.taskId);
      if (!gitRow?.worktree_path || gitRow.worktree_status !== "ready") return null;
      try {
        const proc = Bun.spawn(["git", "diff", "--stat", "HEAD"], {
          cwd: gitRow.worktree_path,
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
        const out = await new Response(proc.stdout).text();
        return out.trim() || null;
      } catch {
        return null;
      }
    },
  };
}
