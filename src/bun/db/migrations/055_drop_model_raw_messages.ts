import type { Database } from "bun:sqlite";

export const id = "055_drop_model_raw_messages";

/**
 * Drops model_raw_messages. The table stored full provider-native payloads
 * (~6 GB/day of writes) and had no production reader — it was write-only debug
 * data whose retention DELETE was a long write-lock holder. Raw model messages
 * are no longer persisted; the WS broadcast side is preserved via
 * StreamProcessor.onRawMessage. Indexes are dropped with the table.
 */
export function up(db: Database): void {
  db.exec("DROP TABLE IF EXISTS model_raw_messages");
}
