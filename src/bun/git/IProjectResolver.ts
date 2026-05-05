export interface IProjectResolver {
  /**
   * Returns the default branch for the given project (e.g. "main").
   * Falls back to "main" when no default_branch is configured.
   */
  getDefaultBranch(workspaceKey: string, projectKey: string): string;

  /**
   * Returns the base path under which worktrees for this workspace are stored.
   * Falls back to `${gitRootPath}/../worktrees` when no worktree_base_path is configured.
   */
  getWorktreeBasePath(workspaceKey: string, projectKey: string, gitRootPath: string): string;
}
