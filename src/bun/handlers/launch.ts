import { getDb } from "../db/index.ts";
import { mapTask } from "../db/mappers.ts";
import type { TaskRow } from "../db/row-types.ts";
import type { LaunchConfig } from "../../shared/rpc-types.ts";
import { readLaunchConfig } from "../launch/config.ts";
import { launchInTerminal, launchApp } from "../launch/launcher.ts";
import { getProjectById } from "../project-store.ts";

export function launchHandlers() {
  return {
    "launch.getConfig": async (params: { taskId: number }): Promise<LaunchConfig | null> => {
      const db = getDb();

      const taskRow = db
        .query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?")
        .get(params.taskId);
      if (!taskRow) return null;

      const project = getProjectById(taskRow.project_id);
      if (!project) return null;
      return readLaunchConfig(project.projectPath);
    },

    "launch.run": async (params: {
      taskId: number;
      command: string;
      mode: "terminal" | "app";
    }): Promise<{ ok: true } | { ok: false; error: string }> => {
      const db = getDb();

      const taskRow = db
        .query<TaskRow, [number]>(
          `SELECT t.*, gc.worktree_path
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.id = ?`,
        )
        .get(params.taskId);
      if (!taskRow) return { ok: false, error: "Task not found" };

      const task = mapTask(taskRow);

      let cwd: string;
      if (task.worktreePath) {
        cwd = task.worktreePath;
      } else {
        const project = getProjectById(taskRow.project_id);
        if (!project) return { ok: false, error: "Project not found" };
        cwd = project.projectPath;
      }

      try {
        if (params.mode === "app") {
          await launchApp(params.command, cwd);
        } else {
          await launchInTerminal(params.command, cwd);
        }
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}
