import type { Database } from "bun:sqlite";

export const id = "053_conversation_injection_state";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_injection_state (
      conversation_id INTEGER NOT NULL,
      injection_type TEXT NOT NULL,
      last_injected_after_compaction_id INTEGER,
      PRIMARY KEY (conversation_id, injection_type)
    );
  `);

  // Guard against minimal/legacy conversations tables (e.g. test fixtures) that
  // lack this column — SQLite has no defensive "column exists" SQL clause.
  const cols = db.query<{ name: string }, []>("PRAGMA table_info(conversations)").all();
  if (!cols.some((c) => c.name === "decisions_injected_after_compaction_id")) return;

  db.exec(`
    INSERT OR IGNORE INTO conversation_injection_state (conversation_id, injection_type, last_injected_after_compaction_id)
    SELECT id, 'decisions', decisions_injected_after_compaction_id
    FROM conversations
    WHERE decisions_injected_after_compaction_id IS NOT NULL;
  `);
}

export function down(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS conversation_injection_state`);
}
