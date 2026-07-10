import type { Database } from "bun:sqlite";

export const id = "053_drop_model_raw_messages";

/**
 * `model_raw_messages` (raw wire-protocol forensic capture) is relocated to a file-based debug
 * log (`~/.railyn/conversations/<conversationId>.debug.<executionId>.jsonl`, see
 * `raw-message-debug-log.ts`). It was never read by running application code — only by humans
 * running manual SQL for forensic inspection — so there is no historical data to migrate; the
 * table (and its indices) can simply be dropped.
 */
export function up(db: Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_model_raw_messages_execution_seq;
    DROP INDEX IF EXISTS idx_model_raw_messages_task_created;
    DROP INDEX IF EXISTS idx_model_raw_messages_engine_type;
    DROP TABLE IF EXISTS model_raw_messages;
  `);
}
