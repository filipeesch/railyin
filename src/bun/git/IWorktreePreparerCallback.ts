// ─── IWorktreePreparerCallback ──────────────────────────────────────────────

/**
 * Callback interface for async worktree preparation.
 * Passed to prepareAndExecute() to receive notification
 * when the worktree is ready or when creation fails.
 */
export interface IWorktreePreparerCallback {
  /** Called when worktree is ready — triggers task execution */
  executeTask(taskId: number, result: PreparedWorktreeResult): Promise<void>;

  /** Called when worktree creation fails — triggers failure state */
  onFailed(taskId: number, error: Error): void;
}

/**
 * Result object returned when worktree preparation succeeds.
 */
export interface PreparedWorktreeResult {
  path: string;
  branch: string;
}
