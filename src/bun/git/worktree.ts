import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { TaskRow, TaskGitContextRow } from "../db/row-types.ts";

// ─── Branch naming ────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function branchName(taskId: number, title: string): string {
  return `task/${taskId}-${slugify(title)}`;
}

// ─── Resolve git binary path ──────────────────────────────────────────────────

const FALLBACK_GIT_PATHS = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

function resolveGit(): string {
  // 1. Config override takes top priority
  const config = getConfig();
  if (config.workspace.git_path) return config.workspace.git_path;

  // 2. Try Bun.which with augmented PATH
  const found = Bun.which("git", {
    PATH: [process.env.PATH, "/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin"]
      .filter(Boolean)
      .join(":"),
  });
  if (found) return found;

  // 3. Hard-coded fallbacks
  for (const p of FALLBACK_GIT_PATHS) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    "git not found. Set workspace.git_path in railyn.yaml (e.g. git_path: /usr/bin/git)",
  );
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

  // Validate git root exists — ENOENT on posix_spawn is misleading when cwd is missing
  if (!existsSync(row.git_root_path)) {
    db.run(
      "UPDATE task_git_context SET worktree_status = 'error' WHERE task_id = ?",
      [taskId],
    );
    throw new Error(
      `git_root_path does not exist: "${row.git_root_path}". ` +
      `Check the project's Git Root Path in settings.`,
    );
  }

  // Ensure worktree parent directory exists (git worktree add requires it)
  const worktreeParent = dirname(worktreePath);
  if (!existsSync(worktreeParent)) {
    mkdirSync(worktreeParent, { recursive: true });
  }

  // Update status to creating
  db.run(
    "UPDATE task_git_context SET worktree_status = 'creating', worktree_path = ?, branch_name = ? WHERE task_id = ?",
    [worktreePath, branch, taskId],
  );

  try {
    // Task 6.2: Create branch + worktree
    const proc = Bun.spawn(
      [resolveGit(), "worktree", "add", "-b", branch, worktreePath, "HEAD"],
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

    // Capture the base SHA — the fork point this worktree was created from.
    // All future diff queries use base_sha..HEAD so committed changes stay visible for review.
    let baseSha: string | null = null;
    try {
      const shaProc = Bun.spawn([resolveGit(), "rev-parse", "HEAD"], {
        cwd: worktreePath,
        stdout: "pipe",
        stderr: "pipe",
      });
      await shaProc.exited;
      if (shaProc.exitCode === 0) {
        baseSha = (await new Response(shaProc.stdout).text()).trim() || null;
      }
    } catch {
      console.warn(`[worktree] could not capture base_sha for task ${taskId}`);
    }

    db.run(
      "UPDATE task_git_context SET worktree_status = 'ready', base_sha = ? WHERE task_id = ?",
      [baseSha, taskId],
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

export async function removeWorktree(taskId: number): Promise<{ warning?: string }> {
  const db = getDb();

  const row = db
    .query<Pick<TaskGitContextRow, "git_root_path" | "worktree_path">, [number]>(
      "SELECT git_root_path, worktree_path FROM task_git_context WHERE task_id = ?",
    )
    .get(taskId);

  if (!row?.worktree_path) return {};

  // If the git root no longer exists on disk, skip the git command and warn.
  if (!existsSync(row.git_root_path)) {
    return {
      warning: `Worktree directory could not be removed: git root "${row.git_root_path}" no longer exists on disk.`,
    };
  }

  try {
    const proc = Bun.spawn(
      [resolveGit(), "worktree", "remove", "--force", row.worktree_path],
      {
        cwd: row.git_root_path,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await proc.exited;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { warning: `Worktree could not be removed: ${msg}` };
  }

  db.run(
    "UPDATE task_git_context SET worktree_status = 'removed' WHERE task_id = ?",
    [taskId],
  );
  return {};
}

// ─── Task 6.4: Register project git context (monorepo / subrepo) ──────────────

export function registerProjectGitContext(
  taskId: number,
  gitRootPath: string,
  subrepoPath?: string,
): void {
  const db = getDb();

  const existing = db
    .query<{ task_id: number }, [number]>(
      "SELECT task_id FROM task_git_context WHERE task_id = ?",
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

export async function triggerWorktreeIfNeeded(
  taskId: number,
  onStatus?: (msg: string) => void,
): Promise<void> {
  const db = getDb();

  const row = db
    .query<Pick<TaskGitContextRow, "worktree_status" | "git_root_path">, [number]>(
      "SELECT worktree_status, git_root_path FROM task_git_context WHERE task_id = ?",
    )
    .get(taskId);

  // Create worktree if not yet created, or retry after a previous failure
  if (row?.git_root_path && (row.worktree_status === "not_created" || row.worktree_status === "error")) {
    onStatus?.("Creating worktree for this task…");
    const result = await createWorktree(taskId);
    onStatus?.(`Worktree ready at \`${result.branch}\``);
  }
}
