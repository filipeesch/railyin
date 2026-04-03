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
} from "../workflow/engine.ts";
import { triggerWorktreeIfNeeded, registerProjectGitContext } from "../git/worktree.ts";
import type { ProjectRow } from "../db/row-types.ts";
import type { OnToken, OnError, OnTaskUpdated } from "../workflow/engine.ts";

export function taskHandlers(onToken: OnToken, onError: OnError, onTaskUpdated: OnTaskUpdated) {
  return {
    "tasks.list": async (params: { boardId: number }): Promise<Task[]> => {
      const db = getDb();
      return db
        .query<TaskRow, [number]>(
          "SELECT * FROM tasks WHERE board_id = ? ORDER BY created_at ASC",
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
  };
}
