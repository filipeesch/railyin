import type { Database } from "bun:sqlite";

export const id = "052_conversation_storage_medium";

/**
 * Adds the discriminant column used by `message-store-resolver.ts` to decide whether a
 * conversation's messages live in the legacy `conversation_messages` SQL table or in a
 * file-backed JSONL store.
 *
 * The column default is `'file'` so every *new* conversation created after this migration
 * automatically opts into file storage with zero changes required at any of the ~6
 * `INSERT INTO conversations` call sites (board-tool-executor.ts, transition-executor.ts,
 * handlers/chat-sessions.ts, handlers/tasks.ts, conversation/messages.ts) — the DB schema
 * default is the single source of truth, not per-call-site logic.
 *
 * Existing (pre-migration) rows must NOT retroactively become file-backed — this change leaves
 * old conversations on SQLite permanently (no backfill/migration of historical data). Since
 * `ALTER TABLE ADD COLUMN ... DEFAULT 'file'` would otherwise apply that default to every
 * existing row too, we snapshot the max pre-migration id first and explicitly reset those rows
 * to `'sqlite'` right after adding the column.
 */
export function up(db: Database): void {
  const maxExistingId = (
    db.query<{ max_id: number | null }, []>("SELECT MAX(id) AS max_id FROM conversations").get()
  )?.max_id ?? null;

  db.exec("ALTER TABLE conversations ADD COLUMN storage_medium TEXT NOT NULL DEFAULT 'file'");

  if (maxExistingId != null) {
    db.run("UPDATE conversations SET storage_medium = 'sqlite' WHERE id <= ?", [maxExistingId]);
  }
}
