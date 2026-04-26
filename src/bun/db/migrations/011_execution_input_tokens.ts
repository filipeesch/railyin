import { Database } from "bun:sqlite";

export const id = "011_execution_input_tokens";

export function up(db: Database): void {
  db.exec("ALTER TABLE executions ADD COLUMN input_tokens INTEGER;");
}
