/**
 * refinement/worktree.ts
 *
 * Git worktree lifecycle management for provider-based scenario execution.
 * Creates a worktree at a pinned commit, resets between scenarios, and
 * removes after provider runs complete.
 */

import { execSync } from "child_process";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// Root of the Railyin project (one level up from this file's directory)
const PROJECT_ROOT = join(import.meta.dir, "..");

export function createWorktree(providerId: string, stableCommit: string): string {
  const timestamp = Date.now();
  const safeId = providerId.replace(/[^a-z0-9-]/gi, "-");
  const worktreePath = `/tmp/railyin-bench-${safeId}-${timestamp}`;

  try {
    execSync(
      `git worktree add "${worktreePath}" "${stableCommit}"`,
      { cwd: PROJECT_ROOT, stdio: "pipe" },
    );
    console.log(`[worktree] created: ${worktreePath} @ ${stableCommit}`);
    return worktreePath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[worktree] failed to create worktree for ${providerId}: ${msg}`);
  }
}

export function resetWorktree(worktreePath: string): void {
  if (!existsSync(worktreePath)) {
    console.warn(`[worktree] reset skipped — path not found: ${worktreePath}`);
    return;
  }
  try {
    execSync("git checkout . && git clean -fd", { cwd: worktreePath, stdio: "pipe" });
    console.log(`[worktree] reset: ${worktreePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[worktree] reset warning for ${worktreePath}: ${msg}`);
  }
}

export function removeWorktree(worktreePath: string): void {
  if (!existsSync(worktreePath)) {
    return; // already gone
  }
  try {
    execSync(
      `git worktree remove --force "${worktreePath}"`,
      { cwd: PROJECT_ROOT, stdio: "pipe" },
    );
    console.log(`[worktree] removed: ${worktreePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[worktree] remove warning for ${worktreePath}: ${msg}`);
  }
}
