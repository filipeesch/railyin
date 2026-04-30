import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { registerProjectGitContext, triggerWorktreeIfNeeded } from "../git/worktree.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let gitDir: string;
let worktreesBase: string;
let configCleanup: () => void;

beforeEach(() => {
  // Create dirs first so we can pass worktree_base_path to setupTestConfig
  gitDir = mkdtempSync(join(tmpdir(), "railyn-git-"));
  worktreesBase = mkdtempSync(join(tmpdir(), "railyn-wt-"));

  const cfg = setupTestConfig(`worktree_base_path: "${worktreesBase}"`);
  configCleanup = cfg.cleanup;
  db = initDb();

  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "test@test.com"', { cwd: gitDir });
  execSync('git config user.name "Test"', { cwd: gitDir });
  writeFileSync(join(gitDir, "README.md"), "hello");
  execSync("git add .", { cwd: gitDir });
  execSync('git commit -m "init"', { cwd: gitDir });
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  rmSync(worktreesBase, { recursive: true, force: true });
  configCleanup();
});

// ─── registerProjectGitContext ────────────────────────────────────────────────

describe("registerProjectGitContext", () => {
  it("creates task_git_context row with not_created status", () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    registerProjectGitContext(taskId, gitDir);

    const row = db
      .query<{ task_id: number; git_root_path: string; worktree_status: string }, [number]>(
        "SELECT task_id, git_root_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row).not.toBeNull();
    expect(row!.git_root_path).toBe(gitDir);
    expect(row!.worktree_status).toBe("not_created");
  });

  it("updates existing row without changing worktree_status", () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    registerProjectGitContext(taskId, "/wrong/path");

    // Manually set status to something else
    db.run("UPDATE task_git_context SET worktree_status = 'ready' WHERE task_id = ?", [taskId]);

    // Re-register with correct path
    registerProjectGitContext(taskId, gitDir);

    const row = db
      .query<{ git_root_path: string; worktree_status: string }, [number]>(
        "SELECT git_root_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row!.git_root_path).toBe(gitDir);
    // status should remain 'ready' (not reset to not_created)
    expect(row!.worktree_status).toBe("ready");
  });
});

// ─── triggerWorktreeIfNeeded ──────────────────────────────────────────────────

describe("triggerWorktreeIfNeeded", () => {
  it("does nothing when no task_git_context row exists", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    // No registerProjectGitContext call — no row exists
    const statuses: string[] = [];
    await triggerWorktreeIfNeeded(taskId, (msg) => statuses.push(msg));
    expect(statuses).toHaveLength(0);
  });

  it("does nothing when worktree_status is already ready", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    registerProjectGitContext(taskId, gitDir);
    db.run("UPDATE task_git_context SET worktree_status = 'ready' WHERE task_id = ?", [taskId]);

    const statuses: string[] = [];
    await triggerWorktreeIfNeeded(taskId, (msg) => statuses.push(msg));
    expect(statuses).toHaveLength(0);
  });

  it("creates worktree and sets status to ready for not_created", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    registerProjectGitContext(taskId, gitDir);

    // Override worktree base to our temp dir
    process.env.RAILYN_DB; // ensure env is set (already by initDb)

    const statuses: string[] = [];
    await triggerWorktreeIfNeeded(taskId, (msg) => statuses.push(msg));

    const row = db
      .query<{ worktree_status: string }, [number]>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row!.worktree_status).toBe("ready");
    expect(statuses[0]).toMatch(/creating worktree/i);
    expect(statuses[1]).toMatch(/ready/i);
  }, 15_000);

  it("sets worktree_path inside worktree_base_path after creation", async () => {
    // Verify the path persisted to task_git_context.worktree_path is a
    // descendant of the configured worktree_base_path.  The orchestrator
    // uses this path to compute the agent's CWD, so it must be within the
    // configured worktrees base directory (not the main repo).
    const { taskId } = seedProjectAndTask(db, gitDir);
    registerProjectGitContext(taskId, gitDir);

    await triggerWorktreeIfNeeded(taskId);

    const row = db
      .query<{ worktree_path: string; worktree_status: string }, [number]>(
        "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row!.worktree_status).toBe("ready");
    expect(row!.worktree_path).toMatch(new RegExp(`^${worktreesBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    expect(row!.worktree_path).not.toMatch(new RegExp(`^${gitDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`));
  }, 15_000);

  it("retries worktree creation when status is error", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    registerProjectGitContext(taskId, gitDir);
    db.run("UPDATE task_git_context SET worktree_status = 'error' WHERE task_id = ?", [taskId]);

    const statuses: string[] = [];
    await triggerWorktreeIfNeeded(taskId, (msg) => statuses.push(msg));

    const row = db
      .query<{ worktree_status: string }, [number]>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row!.worktree_status).toBe("ready");
  }, 15_000);

  it("throws and leaves status as error when git_root_path is invalid", async () => {
    const { taskId } = seedProjectAndTask(db, "/nonexistent/git/root");
    registerProjectGitContext(taskId, "/nonexistent/git/root");

    await expect(triggerWorktreeIfNeeded(taskId)).rejects.toThrow(/does not exist/i);

    const row = db
      .query<{ worktree_status: string }, [number]>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row!.worktree_status).toBe("error");
  });
});
