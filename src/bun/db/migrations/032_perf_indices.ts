import type { Database } from "bun:sqlite";

export const id = "032_perf_indices";

export function up(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_executions_task_status_tokens
      ON executions (task_id, status, input_tokens);
    CREATE INDEX IF NOT EXISTS idx_tasks_board_state
      ON tasks (board_id, workflow_state);
  `);
}
