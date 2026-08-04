import type { Db } from "./db.ts";
import { getDb } from "./index.ts";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type TodoStatus = "pending" | "in-progress" | "done" | "blocked" | "deleted";

export interface TodoItem {
  id: number;
  taskId: number;
  number: number;
  title: string;
  description: string;
  status: TodoStatus;
  result: string | null;
  phase: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TodoListItem {
  id: number;
  number: number;
  title: string;
  status: TodoStatus;
  phase: string | null;
}

export interface TodoUpdate {
  number?: number;
  title?: string;
  description?: string;
  status?: TodoStatus;
  result?: string;
  phase?: string | null;
}

// ─── Row type ─────────────────────────────────────────────────────────────────

interface TodoRow {
  id: number;
  task_id: number;
  number: number;
  title: string;
  description: string;
  status: string;
  result: string | null;
  phase: string | null;
  created_at: string;
  updated_at: string;
}

function mapTodoRow(row: TodoRow): TodoItem {
  return {
    id: row.id,
    taskId: row.task_id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status as TodoStatus,
    result: row.result,
    phase: row.phase,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── TodoRepository ───────────────────────────────────────────────────────────

export class TodoRepository {
  private readonly db: Db;

  /**
   * When `db` is provided the repository uses that connection (handler layer).
   * When omitted it falls back to the global `getDb()` singleton (engine tool context).
   */
  constructor(db?: Db) {
    this.db = db ?? getDb();
  }

  async createTodo(
    taskId: number,
    number: number,
    title: string,
    description: string,
    phase?: string | null,
  ): Promise<TodoListItem> {
    const res = await this.db.exec(
      `INSERT INTO task_todos (task_id, number, title, description, status, phase)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id`,
      [taskId, number, title, description, phase ?? null],
    );
    const id = (res.rows[0] as { id: number }).id;
    return { id, number, title, status: "pending", phase: phase ?? null };
  }

  async editTodo(
    taskId: number,
    id: number,
    update: TodoUpdate,
  ): Promise<TodoListItem | null> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (update.number !== undefined) { values.push(update.number); fields.push(`number = $${values.length}`); }
    if (update.title !== undefined) { values.push(update.title); fields.push(`title = $${values.length}`); }
    if (update.description !== undefined) { values.push(update.description); fields.push(`description = $${values.length}`); }
    if (update.status !== undefined) { values.push(update.status); fields.push(`status = $${values.length}`); }
    if (update.result !== undefined) { values.push(update.result); fields.push(`result = $${values.length}`); }
    if ("phase" in update) { values.push(update.phase ?? null); fields.push(`phase = $${values.length}`); }

    if (fields.length === 0) {
      const row = await this.db.get<Pick<TodoRow, "id" | "number" | "title" | "status" | "phase">>(
        "SELECT id, number, title, status, phase FROM task_todos WHERE id = $1 AND task_id = $2",
        [id, taskId],
      );
      if (!row) return null;
      return { id: row.id, number: row.number, title: row.title, status: row.status as TodoStatus, phase: row.phase };
    }

    fields.push(`updated_at = ${this.db.dialect.now()}`);
    values.push(id);
    const idPos = values.length;
    values.push(taskId);
    const taskPos = values.length;

    const res = await this.db.exec(
      `UPDATE task_todos SET ${fields.join(", ")} WHERE id = $${idPos} AND task_id = $${taskPos}`,
      values,
    );
    if (res.affectedRows === 0) return null;

    const updated = await this.db.get<Pick<TodoRow, "id" | "number" | "title" | "status" | "phase">>(
      "SELECT id, number, title, status, phase FROM task_todos WHERE id = $1 AND task_id = $2",
      [id, taskId],
    );
    if (!updated) return null;
    return { id: updated.id, number: updated.number, title: updated.title, status: updated.status as TodoStatus, phase: updated.phase };
  }

  async deleteTodo(taskId: number, id: number): Promise<TodoListItem | null> {
    const row = await this.db.get<Pick<TodoRow, "id" | "number" | "title" | "status" | "phase">>(
      "SELECT id, number, title, status, phase FROM task_todos WHERE id = $1 AND task_id = $2",
      [id, taskId],
    );
    if (!row) return null;

    await this.db.exec(
      `UPDATE task_todos SET status = 'deleted', updated_at = ${this.db.dialect.now()} WHERE id = $1 AND task_id = $2`,
      [id, taskId],
    );
    return { id: row.id, number: row.number, title: row.title, status: "deleted", phase: row.phase };
  }

  async getTodo(taskId: number, id: number): Promise<TodoItem | { deleted: true; message: string } | null> {
    const row = await this.db.get<TodoRow>(
      "SELECT * FROM task_todos WHERE id = $1 AND task_id = $2",
      [id, taskId],
    );
    if (!row) return null;
    if (row.status === "deleted") {
      return { deleted: true, message: `Todo #${row.number} "${row.title}" has been removed. Skip it and move to the next task.` };
    }
    return mapTodoRow(row);
  }

  async listTodos(taskId: number, includeDeleted = false, currentPhase?: string): Promise<TodoListItem[]> {
    let sql: string;
    let params: (number | string)[];

    if (includeDeleted) {
      if (currentPhase !== undefined) {
        sql = "SELECT id, number, title, status, phase FROM task_todos WHERE task_id = $1 AND (phase IS NULL OR phase = $2) ORDER BY number ASC, id ASC";
        params = [taskId, currentPhase];
      } else {
        sql = "SELECT id, number, title, status, phase FROM task_todos WHERE task_id = $1 ORDER BY number ASC, id ASC";
        params = [taskId];
      }
    } else {
      if (currentPhase !== undefined) {
        sql = "SELECT id, number, title, status, phase FROM task_todos WHERE task_id = $1 AND status != 'deleted' AND (phase IS NULL OR phase = $2) ORDER BY number ASC, id ASC";
        params = [taskId, currentPhase];
      } else {
        sql = "SELECT id, number, title, status, phase FROM task_todos WHERE task_id = $1 AND status != 'deleted' ORDER BY number ASC, id ASC";
        params = [taskId];
      }
    }

    const rows = await this.db.rows<Pick<TodoRow, "id" | "number" | "title" | "status" | "phase">>(sql, params);
    return rows.map((r) => ({ id: r.id, number: r.number, title: r.title, status: r.status as TodoStatus, phase: r.phase }));
  }

  async reprioritizeTodos(
    taskId: number,
    items: Array<{ id: number; number: number }>,
  ): Promise<TodoListItem[]> {
    await this.db.begin(async (tx) => {
      for (const item of items) {
        await tx.exec(
          `UPDATE task_todos SET number = $1, updated_at = ${tx.dialect.now()} WHERE id = $2 AND task_id = $3`,
          [item.number, item.id, taskId],
        );
      }
    });
    return this.listTodos(taskId);
  }
}
