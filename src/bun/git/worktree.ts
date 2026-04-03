import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import type { TaskRow, TaskGitContextRow } from "../db/row-types.ts";

// ─── Branch naming ────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function branchName(taskId: number, title: string): string {
  return `task/${taskId}-${slugify(title)}`;
}

// ─── Resolve worktree base path ───────────────────────────────────────────────

function resolveWorktreeBase(gitRootPath: string): string {
  const config = getConfig();
  const base = config.workspace.worktree_base_path;
  return base ?? `${gitRootPath}/../worktrees`;
}

// ─── Task 6.1: Create worktree ────────────────────────────────────────────────

export async function createWorktree(
  taskId: number,
): Promise<{ path: string; branch: string }> {
  const db = getDb();

  const row = db
    .query<TaskGitContextRow, [number]>(
      "SELECT git_root_path, worktree_path, worktree_status, branch_name, subrepo_path FROM task_git_context WHERE task_id = ?",
    )
    .get(taskId);

  if (!row) throw new Error(`No git context for task ${taskId}`);
  if ((row.worktree_status === "ready" || row.worktree_status === "creating") && row.worktree_path) {
    return { path: row.worktree_path, branch: row.branch_name ?? branchFromPath(row.worktree_path) };
  }

  const task = db.query<TaskRow, [number]>("SELECT id, title, board_id FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const branch = branchName(taskId, task.title);
  const worktreePath = `${resolveWorktreeBase(row.git_root_path)}/${branch}`;

  // Update status to creating
  db.run(
    "UPDATE task_git_context SET worktree_status = 'creating', worktree_path = ?, branch_name = ? WHERE task_id = ?",
    [worktreePath, branch, taskId],
  );

  try {
    // Task 6.2: Create branch + worktree
    const proc = Bun.spawn(
      ["git", "worktree", "add", "-b", branch, worktreePath, "HEAD"],
      {
        cwd: row.git_root_path,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`git worktree add failed (exit ${exitCode}): ${stderr.trim()}`);
    }

    db.run(
      "UPDATE task_git_context SET worktree_status = 'ready' WHERE task_id = ?",
      [taskId],
    );

    return { path: worktreePath, branch };
  } catch (err) {
    db.run(
      "UPDATE task_git_context SET worktree_status = 'error' WHERE task_id = ?",
      [taskId],
    );
    throw err;
  }
}

function branchFromPath(worktreePath: string): string {
  const parts = worktreePath.split("/");
  return parts[parts.length - 1] ?? worktreePath;
}

// ─── Task 6.3: Remove worktree ────────────────────────────────────────────────

export async function removeWorktree(taskId: number): Promise<void> {
  const db = getDb();

  const row = db
    .query<Pick<TaskGitContextRow, "git_root_path" | "worktree_path">, [number]>(
      "SELECT git_root_path, worktree_path FROM task_git_context WHERE task_id = ?",
    )
    .get(taskId);

  if (!row?.worktree_path) return;

  const proc = Bun.spawn(
    ["git", "worktree", "remove", "--force", row.worktree_path],
    {
      cwd: row.git_root_path,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  await proc.exited;

  db.run(
    "UPDATE task_git_context SET worktree_status = 'removed' WHERE task_id = ?",
    [taskId],
  );
}

// ─── Task 6.4: Register project git context (monorepo / subrepo) ──────────────

export function registerProjectGitContext(
  taskId: number,
  gitRootPath: string,
  subrepoPath?: string,
): void {
  const db = getDb();

  const existing = db
    .query<{ id: number }, [number]>(
      "SELECT id FROM task_git_context WHERE task_id = ?",
    )
    .get(taskId);

  if (existing) {
    db.run(
      "UPDATE task_git_context SET git_root_path = ?, subrepo_path = ? WHERE task_id = ?",
      [gitRootPath, subrepoPath ?? null, taskId],
    );
  } else {
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, subrepo_path, worktree_status) VALUES (?, ?, ?, 'not_created')",
      [taskId, gitRootPath, subrepoPath ?? null],
    );
  }
}

// ─── Trigger worktree creation on first active transition ─────────────────────

export async function triggerWorktreeIfNeeded(taskId: number): Promise<void> {
  const db = getDb();

  const row = db
    .query<Pick<TaskGitContextRow, "worktree_status" | "git_root_path">, [number]>(
      "SELECT worktree_status, git_root_path FROM task_git_context WHERE task_id = ?",
    )
    .get(taskId);

  // Only create worktree if git root is known and not yet created
  if (row?.git_root_path && row.worktree_status === "not_created") {
    await createWorktree(taskId);
  }
}
