import type { Database } from "bun:sqlite";
import { startCodeServer, stopCodeServer, getCodeServerEntry } from "../launch/code-server.ts";
import type { CodeRef } from "../../shared/rpc-types.ts";

export function codeServerHandlers(db: Database, broadcast: (msg: object) => void, serverPort: number) {
  return {
    "codeServer.start": async (params: { taskId: number }): Promise<{ port: number } | { error: string }> => {

      const row = db
        .query<{ worktree_path: string | null }, [number]>(
          `SELECT gc.worktree_path
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.id = ?`,
        )
        .get(params.taskId);

      if (!row) return { error: "Task not found" };
      if (!row.worktree_path) return { error: "Task has no worktree path" };

      try {
        const result = await startCodeServer(params.taskId, row.worktree_path, serverPort);
        return { port: result.port };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },

    "codeServer.status": (params: { taskId: number }): { port: number; status: "starting" | "ready" | "error" } | null => {
      return getCodeServerEntry(params.taskId);
    },

    "codeServer.stop": (params: { taskId: number }): { ok: boolean } => {
      const stopped = stopCodeServer(params.taskId);
      return { ok: stopped };
    },

    "codeServer.sendRef": (params: CodeRef): { ok: boolean } => {
      broadcast({ type: "code.ref", payload: params });
      return { ok: true };
    },
  };
}
