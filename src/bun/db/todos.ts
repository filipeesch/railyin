import { getDb } from "./index.ts";

// ─── Todo DB helpers ─────────────────────────────────────────────────────────

export function createTodo(taskId: number, title: string): number {
  const db = getDb();
  const res = db.run(
    `INSERT INTO task_todos (task_id, title, status)
     VALUES (?, ?, 'not-started')`,
    [taskId, title],
  );
  return res.lastInsertRowid as number;
}

export interface TodoUpdate {
  title?: string;
  status?: string;
  result?: string;
}

export function updateTodo(taskId: number, id: number, update: TodoUpdate): boolean {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (update.title !== undefined) { fields.push("title = ?"); values.push(update.title); }
  if (update.status !== undefined) { fields.push("status = ?"); values.push(update.status); }
  if (update.result !== undefined) { fields.push("result = ?"); values.push(update.result); }

  if (fields.length === 0) return true;
  fields.push("updated_at = datetime('now')");
  values.push(String(id), String(taskId));

  const res = db.run(
    `UPDATE task_todos SET ${fields.join(", ")} WHERE id = ? AND task_id = ?`,
    values,
  );
  return res.changes > 0;
}

export function deleteTodo(taskId: number, id: number): boolean {
  const db = getDb();
  const res = db.run("DELETE FROM task_todos WHERE id = ? AND task_id = ?", [id, taskId]);
  return res.changes > 0;
}

export interface TodoListItem {
  id: number;
  title: string;
  status: string;
}

export function listTodos(taskId: number): TodoListItem[] {
  const db = getDb();
  return db
    .query<TodoListItem, [number]>(
      "SELECT id, title, status FROM task_todos WHERE task_id = ? ORDER BY id ASC",
    )
    .all(taskId);
}
