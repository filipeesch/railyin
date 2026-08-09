/**
 * threads.ts — the thread-index RPC handler (CHAT-08, D-01/D-02).
 *
 * `threads.list` derives the thread set from the JSONL dir on disk
 * (`JsonlStore.list()` — the log IS the index, D-04/D-05) and enriches each
 * entry from the live DB: kind via conversations.task_id, name via
 * tasks.title / chat_sessions.title, timestamps via tasks.created_at /
 * chat_sessions.created_at / chat_sessions.last_activity_at with file
 * birthtime/mtime fallback for orphan files. NEVER queries
 * conversations.created_at — the table has NO such column (Pitfall 2).
 */
import type { Database } from "bun:sqlite";
import type { ThreadSummary } from "../../shared/rpc-types.ts";
import type { JsonlStore } from "../copilotkit/jsonl-store.ts";

interface ThreadJoinRow {
  id: number;
  task_id: number | null;
  task_title: string | null;
  task_created: string | null;
  session_title: string | null;
  session_created: string | null;
  session_activity: string | null;
}

export function threadHandlers(db: Database, store: JsonlStore) {
  return {
    "threads.list": async (): Promise<ThreadSummary[]> => {
      const files = store.list();
      if (files.length === 0) return [];

      // Parameterized join — threadIds come from the validated file scan,
      // join keys are fixed columns; no string-built SQL (T-04-03).
      const rows = db.query<ThreadJoinRow, []>(
        `SELECT c.id, c.task_id, t.title AS task_title, t.created_at AS task_created,
                cs.title AS session_title, cs.created_at AS session_created,
                cs.last_activity_at AS session_activity
         FROM conversations c
         LEFT JOIN tasks t        ON t.conversation_id = c.id
         LEFT JOIN chat_sessions cs ON cs.conversation_id = c.id`,
      ).all();
      const byId = new Map(rows.map((r) => [String(r.id), r]));

      return files.map((f) => {
        const row = byId.get(f.threadId);
        const kind: ThreadSummary["kind"] = row && row.task_id != null ? "card" : "session";
        const name = kind === "card" ? (row?.task_title ?? null) : (row?.session_title ?? null);
        const createdAt =
          row?.task_created ?? row?.session_created ?? new Date(f.birthtimeMs ?? f.mtimeMs).toISOString();
        const updatedAt = row?.session_activity ?? new Date(f.mtimeMs).toISOString();
        return { threadId: f.threadId, name, kind, createdAt, updatedAt };
      });
    },
  };
}
