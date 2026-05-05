import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { WorktreeManager } from "../git/WorktreeManager.ts";
import { GitRepositoryManager } from "../git/GitRepositoryManager.ts";
import { TaskGitContextRepository } from "../db/repositories/TaskGitContextRepository.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import type { IProjectResolver } from "../git/IProjectResolver.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let gitDir: string;
let worktreesBase: string;
let configCleanup: () => void;
let manager: WorktreeManager;

/** Stub IProjectResolver — returns configurable values */
function makeProjectResolver(defaultBranch = "main", worktreeBasePath?: string): IProjectResolver {
  return {
    getDefaultBranch: (_wsKey: string, _projectKey: string) => defaultBranch,
    getWorktreeBasePath: (_wsKey: string, _projectKey: string, gitRootPath: string) =>
      worktreeBasePath ?? `${gitRootPath}/../worktrees`,
  };
}

beforeEach(() => {
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

  manager = new WorktreeManager(
    db,
    new WorkspaceRepository(db),
    makeProjectResolver("main", worktreesBase),
    new GitRepositoryManager(),
    new TaskGitContextRepository(db),
  );
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  rmSync(worktreesBase, { recursive: true, force: true });
  configCleanup();
});

// ─── registerContext ──────────────────────────────────────────────────────────

describe("registerContext", () => {
  it("creates task_git_context row with not_created status", () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    manager.registerContext(taskId, gitDir);

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
    manager.registerContext(taskId, "/wrong/path");

    db.run("UPDATE task_git_context SET worktree_status = 'ready' WHERE task_id = ?", [taskId]);

    manager.registerContext(taskId, gitDir);

    const row = db
      .query<{ git_root_path: string; worktree_status: string }, [number]>(
        "SELECT git_root_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row!.git_root_path).toBe(gitDir);
    expect(row!.worktree_status).toBe("ready");
  });
});

// ─── triggerWorktreeIfNeeded ──────────────────────────────────────────────────

describe("triggerWorktreeIfNeeded", () => {
  it("does nothing when no task_git_context row exists", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    const statuses: string[] = [];
    await manager.triggerWorktreeIfNeeded(taskId, (msg) => statuses.push(msg));
    expect(statuses).toHaveLength(0);
  });

  it("does nothing when worktree_status is already ready", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    manager.registerContext(taskId, gitDir);
    db.run("UPDATE task_git_context SET worktree_status = 'ready' WHERE task_id = ?", [taskId]);

    const statuses: string[] = [];
    await manager.triggerWorktreeIfNeeded(taskId, (msg) => statuses.push(msg));
    expect(statuses).toHaveLength(0);
  });

  it("creates worktree and sets status to ready for not_created", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    manager.registerContext(taskId, gitDir);

    const statuses: string[] = [];
    await manager.triggerWorktreeIfNeeded(taskId, (msg) => statuses.push(msg));

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
    const { taskId } = seedProjectAndTask(db, gitDir);
    manager.registerContext(taskId, gitDir);

    await manager.triggerWorktreeIfNeeded(taskId);

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
    manager.registerContext(taskId, gitDir);
    db.run("UPDATE task_git_context SET worktree_status = 'error' WHERE task_id = ?", [taskId]);

    const statuses: string[] = [];
    await manager.triggerWorktreeIfNeeded(taskId, (msg) => statuses.push(msg));

    const row = db
      .query<{ worktree_status: string }, [number]>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row!.worktree_status).toBe("ready");
  }, 15_000);

  it("throws and leaves status as error when git_root_path is invalid", async () => {
    const { taskId } = seedProjectAndTask(db, "/nonexistent/git/root");
    manager.registerContext(taskId, "/nonexistent/git/root");

    await expect(manager.triggerWorktreeIfNeeded(taskId)).rejects.toThrow(/does not exist/i);

    const row = db
      .query<{ worktree_status: string }, [number]>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row!.worktree_status).toBe("error");
  });

  // ─── THE BUG FIX: default branch used instead of HEAD ──────────────────────

  it("creates worktree from defaultBranch, not from HEAD when HEAD is a different branch", async () => {
    // Arrange: add a second commit on a feature branch so HEAD diverges from main
    const mainSha = execSync("git rev-parse HEAD", { cwd: gitDir }).toString().trim();
    execSync("git checkout -b feature-branch", { cwd: gitDir });
    writeFileSync(join(gitDir, "feature.txt"), "feature work");
    execSync("git add .", { cwd: gitDir });
    execSync('git commit -m "feature commit"', { cwd: gitDir });
    // HEAD is now on feature-branch (ahead of main)

    const { taskId } = seedProjectAndTask(db, gitDir);

    // Use a resolver that returns 'main' as the default branch
    const managerWithMain = new WorktreeManager(
      db,
      new WorkspaceRepository(db),
      makeProjectResolver("main", worktreesBase),
      new GitRepositoryManager(),
      new TaskGitContextRepository(db),
    );
    managerWithMain.registerContext(taskId, gitDir);

    // Act: trigger auto-creation (no explicit sourceBranch)
    await managerWithMain.triggerWorktreeIfNeeded(taskId);

    // Assert: worktree was based on main (commit A), not feature-branch (commit B)
    const row = db
      .query<{ worktree_path: string }, [number]>(
        "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    expect(row!.worktree_path).toBeTruthy();

    const worktreeSha = execSync("git rev-parse HEAD", { cwd: row!.worktree_path }).toString().trim();
    expect(worktreeSha).toBe(mainSha);
  }, 15_000);
});

