import type { Db } from "../db.ts";
import type { ITaskGitContextRepository, TaskGitContext } from "./ITaskGitContextRepository.ts";

interface TaskGitContextRow {
  task_id: number;
  git_root_path: string;
  subrepo_path: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  worktree_status: string;
  base_sha: string | null;
}

function mapRow(row: TaskGitContextRow): TaskGitContext {
  return {
    taskId: row.task_id,
    gitRootPath: row.git_root_path,
    subrepoPath: row.subrepo_path,
    branchName: row.branch_name,
    worktreePath: row.worktree_path,
    worktreeStatus: row.worktree_status,
    baseSha: row.base_sha,
  };
}

export class TaskGitContextRepository implements ITaskGitContextRepository {
  constructor(private readonly db: Db) {}

  async upsertContext(taskId: number, gitRootPath: string, subrepoPath?: string): Promise<void> {
    const existing = await this.db.get<{ task_id: number }>(
      "SELECT task_id FROM task_git_context WHERE task_id = $1",
      [taskId],
    );

    if (existing) {
      await this.db.exec(
        "UPDATE task_git_context SET git_root_path = $1, subrepo_path = $2 WHERE task_id = $3",
        [gitRootPath, subrepoPath ?? null, taskId],
      );
    } else {
      await this.db.exec(
        "INSERT INTO task_git_context (task_id, git_root_path, subrepo_path, worktree_status) VALUES ($1, $2, $3, 'not_created')",
        [taskId, gitRootPath, subrepoPath ?? null],
      );
    }
  }

  async getContext(taskId: number): Promise<TaskGitContext | null> {
    const row = await this.db.get<TaskGitContextRow>(
      "SELECT task_id, git_root_path, subrepo_path, branch_name, worktree_path, worktree_status, base_sha FROM task_git_context WHERE task_id = $1",
      [taskId],
    );
    return row ? mapRow(row) : null;
  }

  async updateStatus(taskId: number, status: string): Promise<void> {
    await this.db.exec(
      "UPDATE task_git_context SET worktree_status = $1 WHERE task_id = $2",
      [status, taskId],
    );
  }

  async updateCreating(taskId: number, worktreePath: string, branchName: string): Promise<void> {
    await this.db.exec(
      "UPDATE task_git_context SET worktree_status = 'creating', worktree_path = $1, branch_name = $2 WHERE task_id = $3",
      [worktreePath, branchName, taskId],
    );
  }

  async updateReady(taskId: number, baseSha: string | null): Promise<void> {
    await this.db.exec(
      "UPDATE task_git_context SET worktree_status = 'ready', base_sha = $1 WHERE task_id = $2",
      [baseSha, taskId],
    );
  }

  async updateRemoved(taskId: number): Promise<void> {
    await this.db.exec(
      "UPDATE task_git_context SET worktree_status = 'removed' WHERE task_id = $1",
      [taskId],
    );
  }
}
