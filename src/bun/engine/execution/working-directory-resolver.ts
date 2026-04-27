import { relative, join } from "node:path";
import { getDb } from "../../db/index.ts";
import { getProjectByKey } from "../../project-store.ts";
import { getTaskWorkspaceKey } from "../../workspace-context.ts";
import type { TaskRow, TaskGitContextRow } from "../../db/row-types.ts";

/**
 * Resolves the working directory for a task execution.
 *
 * Priority:
 *   1. worktree_path + relative(gitRootPath, projectPath)  — when ready
 *   2. projectPath                                          — pre-worktree
 *   3. throw                                               — neither found
 */
export class WorkingDirectoryResolver {
  resolve(task: TaskRow): string {
    const workspaceKey = getTaskWorkspaceKey(task.id);
    const project = getProjectByKey(workspaceKey, task.project_key);
    const projectDirectory = project?.projectPath?.trim();

    const db = getDb();
    const gitRow = db
      .query<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(task.id);

    if (gitRow?.worktree_status === "ready" && gitRow.worktree_path) {
      const worktreePath = gitRow.worktree_path;
      if (!projectDirectory) {
        return worktreePath;
      }
      const gitRootPath = project?.gitRootPath?.trim() ?? projectDirectory;
      const relSubPath = relative(gitRootPath, projectDirectory);
      if (relSubPath.startsWith("..")) {
        throw new Error(
          `projectPath "${projectDirectory}" is outside gitRootPath "${gitRootPath}". ` +
          `Check the project configuration in workspace.yaml.`,
        );
      }
      return relSubPath ? join(worktreePath, relSubPath) : worktreePath;
    }

    if (projectDirectory) {
      return projectDirectory;
    }

    throw new Error(`Project directory not found for project_key=${task.project_key}`);
  }
}
