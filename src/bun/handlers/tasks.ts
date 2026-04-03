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
import { triggerWorktreeIfNeeded } from "../git/worktree.ts";
import type { OnToken, OnError } from "../workflow/engine.ts";

export function taskHandlers(onToken: OnToken, onError: OnError) {
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
      // Trigger worktree on first active transition out of backlog
      await triggerWorktreeIfNeeded(params.taskId);
      return handleTransition(params.taskId, params.toState, onToken, onError);
    },

    "tasks.sendMessage": async (params: {
      taskId: number;
      content: string;
    }): Promise<{ message: ConversationMessage; executionId: number }> => {
      const warning = estimateContextWarning(params.taskId);
      if (warning) {
        console.warn(`[railyn] context warning for task ${params.taskId}: ${warning}`);
      }
      return handleHumanTurn(params.taskId, params.content, onToken, onError);
    },

    "tasks.retry": async (params: {
      taskId: number;
    }): Promise<{ task: Task; executionId: number }> => {
      return handleRetry(params.taskId, onToken, onError);
    },
  };
}
