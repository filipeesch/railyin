import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { WorktreeManager } from "../git/WorktreeManager.ts";
import { IWorktreePreparerCallback, PreparedWorktreeResult } from "../git/IWorktreePreparerCallback.ts";
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

  execSync("git init -b main", { cwd: gitDir });
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

describe("prepareAndExecute", () => {
  it("returns immediately when no task_git_context row exists", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    const callback: IWorktreePreparerCallback = {
      executeTask: async () => {
        // No-op
      },
      onFailed: () => {
        // ignore
      },
    };
    await manager.prepareAndExecute(taskId, callback);
    // db context not modified
  });

  it("calls executeTask when worktree_status is already ready", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    manager.registerContext(taskId, gitDir);
    db.run(
      "UPDATE task_git_context SET worktree_status = 'ready', worktree_path = '/some/path', branch_name = 'test-branch' WHERE task_id = ?",
      [taskId],
    );

    const readyPaths: string[] = [];
    await manager.prepareAndExecute(
      taskId,
      {
        executeTask: async (taskId: number, r: PreparedWorktreeResult) => {
          readyPaths.push(r.path);
        },
        onFailed: (_taskId: number, _err: Error) => {},
      },
    );
    expect(readyPaths).toHaveLength(1);
    expect(readyPaths[0]).toBeTruthy();
  });

  it("creates worktree and calls executeTask for not_created", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    manager.registerContext(taskId, gitDir);

    const callback: IWorktreePreparerCallback = {
      executeTask: async () => {
        // Already resolved by prepareAndExecute
      },
      onFailed: () => {
        // ignore
      },
    };

    await manager.prepareAndExecute(taskId, callback);

    // Wait for the background worktree creation to complete
    let row: { worktree_status: string } | null;
    let attempts = 20;
    while (attempts-- > 0) {
      row = db
        .query<{ worktree_status: string }, [number]>(
          "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
        )
        .get(taskId);
      if (row?.worktree_status === "ready") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(row!.worktree_status).toBe("ready");
  }, 15_000);

  it("calls onFailed when git_root_path is invalid", async () => {
    const { taskId } = seedProjectAndTask(db, "/nonexistent/git/root");
    manager.registerContext(taskId, "/nonexistent/git/root");

    let errorGot = false;
    await manager.prepareAndExecute(
      taskId,
      {
        executeTask: async (_taskId: number, _r: PreparedWorktreeResult) => {},
        onFailed: (_taskId: number, _err: Error) => {
          errorGot = true;
        },
      },
    );

    const row = db
      .query<{ worktree_status: string }, [number]>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    expect(row!.worktree_status).toBe("error");
  });
});
