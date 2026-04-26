import { Database } from "bun:sqlite";

export const id = "009_execution_cost";

export function up(db: Database): void {
  db.exec("ALTER TABLE executions ADD COLUMN cost_estimate REAL;");
}
