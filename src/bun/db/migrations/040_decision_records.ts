import type { Database } from "bun:sqlite";

export const id = "040_decision_records";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decision_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS decision_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES decision_batches(id) ON DELETE SET NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      weight TEXT NOT NULL DEFAULT 'medium' CHECK (weight IN ('critical', 'medium', 'easy')),
      notes TEXT,
      revision_count INTEGER NOT NULL DEFAULT 0,
      is_source_ai INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS decision_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER NOT NULL REFERENCES decision_records(id) ON DELETE CASCADE,
      previous_answer TEXT NOT NULL,
      previous_notes TEXT,
      reason TEXT NOT NULL,
      revised_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_decision_records_conversation_deleted
      ON decision_records(conversation_id, is_deleted);

    CREATE INDEX IF NOT EXISTS idx_decision_revisions_decision_id
      ON decision_revisions(decision_id);
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_decision_revisions_decision_id;
    DROP INDEX IF EXISTS idx_decision_records_conversation_deleted;
    DROP TABLE IF EXISTS decision_revisions;
    DROP TABLE IF EXISTS decision_records;
    DROP TABLE IF EXISTS decision_batches;
  `);
}
