export interface TaskGitContext {
  taskId: number;
  gitRootPath: string;
  subrepoPath: string | null;
  branchName: string | null;
  worktreePath: string | null;
  worktreeStatus: string;
  baseSha: string | null;
}

export interface ITaskGitContextRepository {
  upsertContext(taskId: number, gitRootPath: string, subrepoPath?: string): void;
  getContext(taskId: number): TaskGitContext | null;
  updateStatus(taskId: number, status: string): void;
  updateCreating(taskId: number, worktreePath: string, branchName: string): void;
  updateReady(taskId: number, baseSha: string | null): void;
  updateRemoved(taskId: number): void;
}
