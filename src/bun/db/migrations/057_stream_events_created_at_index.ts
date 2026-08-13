import type { Database } from "bun:sqlite";
import { hasTable } from "./_utils.ts";

export const id = "057_stream_events_created_at_index";

/**
 * Indexes stream_events(created_at) so the retention job's batched
 * `DELETE ... WHERE created_at < now-4h` predicate can use an index scan
 * instead of a full table scan. Guarded by hasTable for partial-schema
 * environments (tests that pre-mark 018 applied without the table).
 */
export function up(db: Database): void {
  if (hasTable(db, "stream_events")) {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_stream_events_created_at ON stream_events (created_at)",
    );
  }
}
