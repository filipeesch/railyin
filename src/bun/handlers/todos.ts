import type { Database } from "bun:sqlite";
import { TodoRepository } from "../db/todos.ts";
import type { TodoStatus } from "../db/todos.ts";

export function todoHandlers(db: Database) {
  const todoRepo = new TodoRepository(db);

  return {
    // ─── todos.list ───────────────────────────────────────────────────────────
    "todos.list": async (params: { taskId: number; includeDeleted?: boolean }) => {
      return todoRepo.listTodos(params.taskId, params.includeDeleted ?? false);
    },

    // ─── todos.get ────────────────────────────────────────────────────────────
    "todos.get": async (params: { taskId: number; todoId: number }) => {
      return todoRepo.getTodo(params.taskId, params.todoId);
    },

    // ─── todos.create ─────────────────────────────────────────────────────────
    "todos.create": async (params: { taskId: number; number: number; title: string; description: string; phase?: string }) => {
      return todoRepo.createTodo(params.taskId, params.number, params.title, params.description, params.phase);
    },

    // ─── todos.edit ───────────────────────────────────────────────────────────
    "todos.edit": async (params: { taskId: number; todoId: number; number?: number; title?: string; description?: string; status?: string; phase?: string | null }) => {
      const todo = todoRepo.getTodo(params.taskId, params.todoId);
      if (!todo) return { error: "Todo not found" };
      if ("deleted" in todo) return { error: "Cannot edit deleted todo" };
      if (todo.status !== "pending") {
        return { error: "Can only edit description of pending todos" };
      }
      const update: Parameters<typeof todoRepo.editTodo>[2] = {
        number: params.number,
        title: params.title,
        description: params.description,
        status: params.status as TodoStatus | undefined,
      };
      if ("phase" in params) update.phase = params.phase;
      return todoRepo.editTodo(params.taskId, params.todoId, update);
    },

    // ─── todos.delete ─────────────────────────────────────────────────────────
    "todos.delete": async (params: { taskId: number; todoId: number }) => {
      return todoRepo.deleteTodo(params.taskId, params.todoId);
    },
  };
}
