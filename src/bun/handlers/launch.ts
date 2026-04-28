import { existsSync } from "fs";
import { getDb } from "../db/index.ts";
import { mapTask } from "../db/mappers.ts";
import type { TaskRow } from "../db/row-types.ts";
import type { LaunchConfig } from "../../shared/rpc-types.ts";
import { readLaunchConfig } from "../launch/config.ts";
import { launchApp, launchInTerminal } from "../launch/launcher.ts";
import { createPtySession, killPtySession } from "../launch/pty.ts";
import { getLoadedProjectByKey } from "../project-store.ts";

export function launchHandlers() {
  return {
    "launch.getConfig": async (params: { taskId: number }): Promise<LaunchConfig | null> => {
      const db = getDb();

      const row = db
        .query<{ project_key: string; workspace_key: string }, [number]>(
          `SELECT t.project_key, b.workspace_key
           FROM tasks t
           JOIN boards b ON b.id = t.board_id
           WHERE t.id = ?`,
        )
        .get(params.taskId);
      if (!row) return null;

      const project = getLoadedProjectByKey(row.workspace_key, row.project_key);
      if (!project) return null;
      return readLaunchConfig(project.projectPath);
    },

    "launch.run": async (params: {
      taskId: number;
      command: string;
      mode: "terminal" | "external-terminal" | "app";
    }): Promise<{ ok: true; sessionId?: string } | { ok: false; error: string }> => {
      const db = getDb();

      const taskRow = db
        .query<TaskRow & { worktree_path: string | null; workspace_key: string }, [number]>(
          `SELECT t.*, gc.worktree_path, b.workspace_key
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           JOIN boards b ON b.id = t.board_id
           WHERE t.id = ?`,
        )
        .get(params.taskId);
      if (!taskRow) return { ok: false, error: "Task not found" };

      const task = mapTask(taskRow);

      let cwd: string;
      if (task.worktreePath) {
        if (!existsSync(task.worktreePath)) {
          return { ok: false, error: `Worktree directory no longer exists: ${task.worktreePath}` };
        }
        cwd = task.worktreePath;
      } else {
        const project = getLoadedProjectByKey(taskRow.workspace_key, taskRow.project_key);
        if (!project) return { ok: false, error: "Project not found" };
        if (!existsSync(project.projectPath)) {
          return { ok: false, error: `Project directory does not exist: ${project.projectPath}` };
        }
        cwd = project.projectPath;
      }

      try {
        if (params.mode === "app") {
          await launchApp(params.command, cwd);
          return { ok: true };
        } else if (params.mode === "external-terminal") {
          await launchInTerminal(params.command, cwd);
          return { ok: true };
        } else {
          // mode === "terminal" — inline PTY session
          const session = createPtySession(params.command, cwd);
          return { ok: true, sessionId: session.id };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },

    "launch.shell": async (params: { cwd: string }): Promise<{ sessionId: string }> => {
      const shell = process.env.SHELL ?? "/bin/bash";
      const session = createPtySession(shell, params.cwd);
      return { sessionId: session.id };
    },

    "launch.kill": async (params: { sessionId: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
      const killed = killPtySession(params.sessionId);
      if (!killed) return { ok: false, error: "Session not found" };
      return { ok: true };
    },
  };
}
