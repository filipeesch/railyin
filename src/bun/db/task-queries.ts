import type { Database } from "bun:sqlite";
import type { Task, ChatSession } from "../../shared/rpc-types.ts";
import type { TaskRow, ChatSessionRow } from "./row-types.ts";
import { mapTask, mapChatSession } from "./mappers.ts";

export function fetchTaskWithModel(db: Database, taskId: number): Task | null {
  const row = db
    .query<TaskRow, [number]>(
      `SELECT t.*,
              gc.worktree_status, gc.branch_name, gc.worktree_path,
              (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count,
              c.model AS conversation_model,
              c.sampling_preset_override AS conversation_sampling_preset_override
       FROM tasks t
       LEFT JOIN task_git_context gc ON gc.task_id = t.id
       LEFT JOIN conversations c ON c.id = t.conversation_id
       WHERE t.id = ?`,
    )
    .get(taskId);
  return row ? mapTask(row) : null;
}

export function fetchChatSessionWithModel(db: Database, sessionId: number): ChatSession | null {
  const row = db
    .query<ChatSessionRow, [number]>(
      `SELECT cs.*, c.model AS conversation_model,
              c.sampling_preset_override AS conversation_sampling_preset_override
       FROM chat_sessions cs
       LEFT JOIN conversations c ON c.id = cs.conversation_id
       WHERE cs.id = ?`,
    )
    .get(sessionId);
  return row ? mapChatSession(row) : null;
}
