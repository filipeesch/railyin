import { join } from "node:path";
import type { Db } from "../../db/db.ts";
import type { IWorkspaceRepository } from "../../db/workspace-repository.ts";
import { getLoadedProjectByKey } from "../../project-store.ts";
import type { TaskRow, TaskGitContextRow } from "../../db/row-types.ts";

export interface IWorkingDirectoryResolver {
  resolve(task: TaskRow): Promise<string>;
}

/**
 * Resolves the working directory for a task execution.
 *
 * Priority:
 *   1. worktree_path + project.subPath  — when ready (monorepo: join; standalone: worktreePath)
 *   2. projectPath                      — pre-worktree
 *   3. throw                            — neither found
 */
export class WorkingDirectoryResolver implements IWorkingDirectoryResolver {
  constructor(
    private readonly db: Db,
    private readonly wsRepo: IWorkspaceRepository,
  ) {}

  async resolve(task: TaskRow): Promise<string> {
    const workspaceKey = await this.wsRepo.getTaskWorkspaceKey(task.id);
    const project = getLoadedProjectByKey(workspaceKey, task.project_key);
    const projectDirectory = project?.projectPath;

    const gitRow = await this.db.get<Pick<TaskGitContextRow, "worktree_path" | "worktree_status">>(
      "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = $1",
      [task.id],
    );

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

