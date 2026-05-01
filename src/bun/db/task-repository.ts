import type { Database } from "bun:sqlite";
import type { Task } from "../../shared/rpc-types.ts";
import type { TaskRow } from "./row-types.ts";
import { mapTask } from "./mappers.ts";

export class TaskRepository {
  constructor(private readonly db: Database) {}

  findById(id: number): Task | null {
    const row = this.db
      .query<TaskRow, [number]>(
        `SELECT t.*,
                gc.worktree_status, gc.branch_name, gc.worktree_path,
                (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
         FROM tasks t
         LEFT JOIN task_git_context gc ON gc.task_id = t.id
         WHERE t.id = ?`,
      )
      .get(id);
    return row ? mapTask(row) : null;
  }
}
