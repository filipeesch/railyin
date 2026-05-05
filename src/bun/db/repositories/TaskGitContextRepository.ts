import type { Database } from "bun:sqlite";
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
  constructor(private readonly db: Database) {}

  upsertContext(taskId: number, gitRootPath: string, subrepoPath?: string): void {
    const existing = this.db
      .query<{ task_id: number }, [number]>(
        "SELECT task_id FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    if (existing) {
      this.db.run(
        "UPDATE task_git_context SET git_root_path = ?, subrepo_path = ? WHERE task_id = ?",
        [gitRootPath, subrepoPath ?? null, taskId],
      );
    } else {
      this.db.run(
        "INSERT INTO task_git_context (task_id, git_root_path, subrepo_path, worktree_status) VALUES (?, ?, ?, 'not_created')",
        [taskId, gitRootPath, subrepoPath ?? null],
      );
    }
  }

  getContext(taskId: number): TaskGitContext | null {
    const row = this.db
      .query<TaskGitContextRow, [number]>(
        "SELECT task_id, git_root_path, subrepo_path, branch_name, worktree_path, worktree_status, base_sha FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    return row ? mapRow(row) : null;
  }

  updateStatus(taskId: number, status: string): void {
    this.db.run(
      "UPDATE task_git_context SET worktree_status = ? WHERE task_id = ?",
      [status, taskId],
    );
  }

  updateCreating(taskId: number, worktreePath: string, branchName: string): void {
    this.db.run(
      "UPDATE task_git_context SET worktree_status = 'creating', worktree_path = ?, branch_name = ? WHERE task_id = ?",
      [worktreePath, branchName, taskId],
    );
  }

  updateReady(taskId: number, baseSha: string | null): void {
    this.db.run(
      "UPDATE task_git_context SET worktree_status = 'ready', base_sha = ? WHERE task_id = ?",
      [baseSha, taskId],
    );
  }

  updateRemoved(taskId: number): void {
    this.db.run(
      "UPDATE task_git_context SET worktree_status = 'removed' WHERE task_id = ?",
      [taskId],
    );
  }
}
