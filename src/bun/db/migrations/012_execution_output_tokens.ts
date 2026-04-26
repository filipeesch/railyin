import { Database } from "bun:sqlite";

export const id = "012_execution_output_tokens";

export function up(db: Database): void {
  db.exec("ALTER TABLE executions ADD COLUMN output_tokens INTEGER;");
}
