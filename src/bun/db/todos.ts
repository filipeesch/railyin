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

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function createTodo(
  taskId: number,
  number: number,
  title: string,
  description: string,
  phase?: string | null,
): TodoListItem {
  const db = getDb();
  const res = db.run(
    `INSERT INTO task_todos (task_id, number, title, description, status, phase)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [taskId, number, title, description, phase ?? null],
  );
  const id = res.lastInsertRowid as number;
  return { id, number, title, status: "pending", phase: phase ?? null };
}

export function editTodo(
  taskId: number,
  id: number,
  update: TodoUpdate,
): TodoListItem | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (update.number !== undefined) { fields.push("number = ?"); values.push(update.number); }
  if (update.title !== undefined) { fields.push("title = ?"); values.push(update.title); }
  if (update.description !== undefined) { fields.push("description = ?"); values.push(update.description); }
  if (update.status !== undefined) { fields.push("status = ?"); values.push(update.status); }
  if (update.result !== undefined) { fields.push("result = ?"); values.push(update.result); }
  if ("phase" in update) { fields.push("phase = ?"); values.push(update.phase ?? null); }

  if (fields.length === 0) {
    const row = db
      .query<Pick<TodoRow, "id" | "number" | "title" | "status" | "phase">, [number, number]>(
        "SELECT id, number, title, status, phase FROM task_todos WHERE id = ? AND task_id = ?",
      )
      .get(id, taskId);
    if (!row) return null;
    return { id: row.id, number: row.number, title: row.title, status: row.status as TodoStatus, phase: row.phase };
  }

  fields.push("updated_at = datetime('now')");
  values.push(id, taskId);

  const res = db.run(
    `UPDATE task_todos SET ${fields.join(", ")} WHERE id = ? AND task_id = ?`,
    values,
  );
  if (res.changes === 0) return null;

  const updated = db
    .query<Pick<TodoRow, "id" | "number" | "title" | "status" | "phase">, [number, number]>(
      "SELECT id, number, title, status, phase FROM task_todos WHERE id = ? AND task_id = ?",
    )
    .get(id, taskId);
  if (!updated) return null;
  return { id: updated.id, number: updated.number, title: updated.title, status: updated.status as TodoStatus, phase: updated.phase };
}

export function deleteTodo(taskId: number, id: number): TodoListItem | null {
  const db = getDb();
  const row = db
    .query<Pick<TodoRow, "id" | "number" | "title" | "status" | "phase">, [number, number]>(
      "SELECT id, number, title, status, phase FROM task_todos WHERE id = ? AND task_id = ?",
    )
    .get(id, taskId);
  if (!row) return null;

  db.run(
    "UPDATE task_todos SET status = 'deleted', updated_at = datetime('now') WHERE id = ? AND task_id = ?",
    [id, taskId],
  );
  return { id: row.id, number: row.number, title: row.title, status: "deleted", phase: row.phase };
}

export function getTodo(taskId: number, id: number): TodoItem | { deleted: true; message: string } | null {
  const db = getDb();
  const row = db
    .query<TodoRow, [number, number]>(
      "SELECT * FROM task_todos WHERE id = ? AND task_id = ?",
    )
    .get(id, taskId);
  if (!row) return null;
  if (row.status === "deleted") {
    return { deleted: true, message: `Todo #${row.number} "${row.title}" has been removed. Skip it and move to the next task.` };
  }
  return mapTodoRow(row);
}

export function listTodos(taskId: number, includeDeleted = false, currentPhase?: string): TodoListItem[] {
  const db = getDb();
  let sql: string;
  let params: (number | string)[];

  if (includeDeleted) {
    if (currentPhase !== undefined) {
      sql = "SELECT id, number, title, status, phase FROM task_todos WHERE task_id = ? AND (phase IS NULL OR phase = ?) ORDER BY number ASC, id ASC";
      params = [taskId, currentPhase];
    } else {
      sql = "SELECT id, number, title, status, phase FROM task_todos WHERE task_id = ? ORDER BY number ASC, id ASC";
      params = [taskId];
    }
  } else {
    if (currentPhase !== undefined) {
      sql = "SELECT id, number, title, status, phase FROM task_todos WHERE task_id = ? AND status != 'deleted' AND (phase IS NULL OR phase = ?) ORDER BY number ASC, id ASC";
      params = [taskId, currentPhase];
    } else {
      sql = "SELECT id, number, title, status, phase FROM task_todos WHERE task_id = ? AND status != 'deleted' ORDER BY number ASC, id ASC";
      params = [taskId];
    }
  }

  return db
    .query<Pick<TodoRow, "id" | "number" | "title" | "status" | "phase">, typeof params>(sql)
    .all(...params)
    .map((r) => ({ id: r.id, number: r.number, title: r.title, status: r.status as TodoStatus, phase: r.phase }));
}

export function reprioritizeTodos(
  taskId: number,
  items: Array<{ id: number; number: number }>,
): TodoListItem[] {
  const db = getDb();
  db.transaction(() => {
    for (const item of items) {
      db.run(
        "UPDATE task_todos SET number = ?, updated_at = datetime('now') WHERE id = ? AND task_id = ?",
        [item.number, item.id, taskId],
      );
    }
  })();
  return listTodos(taskId);
}
