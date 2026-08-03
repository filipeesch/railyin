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
  upsertContext(taskId: number, gitRootPath: string, subrepoPath?: string): Promise<void>;
  getContext(taskId: number): Promise<TaskGitContext | null>;
  updateStatus(taskId: number, status: string): Promise<void>;
  updateCreating(taskId: number, worktreePath: string, branchName: string): Promise<void>;
  updateReady(taskId: number, baseSha: string | null): Promise<void>;
  updateRemoved(taskId: number): Promise<void>;
}
