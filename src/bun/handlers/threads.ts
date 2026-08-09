/**
 * threads.ts — the thread-index RPC handler (CHAT-08, D-01/D-02).
 *
 * `threads.list` derives the thread set from the JSONL dir on disk
 * (`JsonlStore.list()` — the log IS the index, D-04/D-05) and enriches each
 * entry from the live DB: kind via conversations.task_id, name via
 * tasks.title / chat_sessions.title, timestamps via tasks.created_at /
 * chat_sessions.created_at / chat_sessions.last_activity_at with file
 * birthtime/mtime fallback for orphan files. DB timestamps are normalized
 * to ISO-8601 (naive-UTC "YYYY-MM-DD HH:MM:SS" → ISO string contract —
 * Pitfall 1). NEVER queries conversations.created_at — the table has NO such
 * column (Pitfall 2).
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

/**
 * Normalize a DB datetime column to an ISO-8601 string — the ThreadSummary
 * contract promises ISO strings, but SQLite `datetime('now')` emits naive-UTC
 * "YYYY-MM-DD HH:MM:SS" (migrations 001/026) that `new Date()` would parse as
 * LOCAL time (Pitfall 1 — the same normalization import.ts applies). Values
 * already carrying a timezone are parsed verbatim; unparseable values yield
 * null so the caller falls back to the next source.
 */
function toIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const candidate = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw.trim()) ? raw : raw.replace(" ", "T") + "Z";
  const ts = Date.parse(candidate);
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
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
          toIso(row?.task_created) ?? toIso(row?.session_created) ?? new Date(f.birthtimeMs ?? f.mtimeMs).toISOString();
        const updatedAt = toIso(row?.session_activity) ?? new Date(f.mtimeMs).toISOString();
        return { threadId: f.threadId, name, kind, createdAt, updatedAt };
      });
    },
  };
}
