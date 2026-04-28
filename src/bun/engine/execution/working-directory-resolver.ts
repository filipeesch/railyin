import { join } from "node:path";
import { getDb } from "../../db/index.ts";
import { getLoadedProjectByKey } from "../../project-store.ts";
import { getTaskWorkspaceKey } from "../../workspace-context.ts";
import type { TaskRow, TaskGitContextRow } from "../../db/row-types.ts";

/**
 * Resolves the working directory for a task execution.
 *
 * Priority:
 *   1. worktree_path + project.subPath  — when ready (monorepo: join; standalone: worktreePath)
 *   2. projectPath                      — pre-worktree
 *   3. throw                            — neither found
 */
export class WorkingDirectoryResolver {
  resolve(task: TaskRow): string {
    const workspaceKey = getTaskWorkspaceKey(task.id);
    const project = getLoadedProjectByKey(workspaceKey, task.project_key);
    const projectDirectory = project?.projectPath;

    const db = getDb();
    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(task.id);

    if (gitRow?.worktree_status === "ready" && gitRow.worktree_path) {
      const worktreePath = gitRow.worktree_path;
      if (!project || !projectDirectory) {
        return worktreePath;
      }
      if (project.subPath.startsWith("..")) {
        throw new Error(
          `projectPath is outside gitRootPath for project "${task.project_key}". ` +
            `Check workspace.yaml: project_path must be inside git_root_path.`,
        );
      }
      return project.subPath ? join(worktreePath, project.subPath) : worktreePath;
    }

    if (projectDirectory) {
      return projectDirectory;
    }

    throw new Error(`Project directory not found for project_key=${task.project_key}`);
  }
}
