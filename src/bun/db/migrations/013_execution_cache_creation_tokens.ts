import { Database } from "bun:sqlite";

export const id = "013_execution_cache_creation_tokens";

export function up(db: Database): void {
  db.exec("ALTER TABLE executions ADD COLUMN cache_creation_input_tokens INTEGER;");
}
