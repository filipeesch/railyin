import type { Database } from "bun:sqlite";

export const id = "033_stream_events_exec_index";

export function up(db: Database): void {
  // Composite index covering the correlated subquery in getStreamEventsByConversation:
  //   WHERE conversation_id = ? AND execution_id = (SELECT MAX(execution_id) ... WHERE conversation_id = ?)
  // The (conversation_id, execution_id, seq) ordering lets SQLite find MAX(execution_id) via
  // a single backwards scan within the conversation's range, then range-scan by seq.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stream_events_conv_exec_seq
      ON stream_events (conversation_id, execution_id, seq);
  `);
}
