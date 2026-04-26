import { Database } from "bun:sqlite";
import { hasTable } from "./_utils.ts";

export const id = "031_conversation_pagination_index";

export function up(db: Database): void {
  if (hasTable(db, "conversation_messages")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_conv_id
        ON conversation_messages(conversation_id, id DESC);
    `);
  }
}
