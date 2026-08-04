import type { Db } from "./db.ts";
import type { Task, ChatSession } from "../../shared/rpc-types.ts";
import type { TaskRow, ChatSessionRow } from "./row-types.ts";
import { mapTask, mapChatSession } from "./mappers.ts";

export async function fetchTaskWithModel(db: Db, taskId: number): Promise<Task | null> {
  const row = await db.get<TaskRow>(
    `SELECT t.*,
            gc.worktree_status, gc.branch_name, gc.worktree_path,
            (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count,
            c.model AS conversation_model,
            c.sampling_preset_override AS conversation_sampling_preset_override,
            c.model_params AS conversation_model_params
     FROM tasks t
     LEFT JOIN task_git_context gc ON gc.task_id = t.id
     LEFT JOIN conversations c ON c.id = t.conversation_id
     WHERE t.id = $1`,
    [taskId],
  );
  return row ? mapTask(row) : null;
}

export async function fetchChatSessionWithModel(db: Db, sessionId: number): Promise<ChatSession | null> {
  const row = await db.get<ChatSessionRow>(
    `SELECT cs.*, c.model AS conversation_model,
            c.sampling_preset_override AS conversation_sampling_preset_override,
            c.model_params AS conversation_model_params
     FROM chat_sessions cs
     LEFT JOIN conversations c ON c.id = cs.conversation_id
     WHERE cs.id = $1`,
    [sessionId],
  );
  return row ? mapChatSession(row) : null;
}
