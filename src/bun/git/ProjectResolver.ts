import { getLoadedProjectByKey } from "../project-store.ts";
import { getWorkspaceConfig } from "../workspace-context.ts";
import type { IProjectResolver } from "./IProjectResolver.ts";

export class ProjectResolver implements IProjectResolver {
  getDefaultBranch(workspaceKey: string, projectKey: string): string {
    const project = getLoadedProjectByKey(workspaceKey, projectKey);
    return project?.defaultBranch ?? "main";
  }

  getWorktreeBasePath(workspaceKey: string, _projectKey: string, gitRootPath: string): string {
    const config = getWorkspaceConfig(workspaceKey);
    return config.workspace.worktree_base_path ?? `${gitRootPath}/../worktrees`;
  }
}
