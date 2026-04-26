import { Database } from "bun:sqlite";

export const id = "014_execution_cache_read_tokens";

export function up(db: Database): void {
  db.exec("ALTER TABLE executions ADD COLUMN cache_read_input_tokens INTEGER;");
}
