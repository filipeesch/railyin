import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "019_add_parent_block_id";

export function up(db: Database): void {
  // For fresh DBs parent_block_id is already in the 018_stream_events schema.
  // For existing DBs that were created before that column existed, add it here.
  if (hasTable(db, "stream_events") && !hasColumn(db, "stream_events", "parent_block_id")) {
    db.exec("ALTER TABLE stream_events ADD COLUMN parent_block_id TEXT");
  }
}
