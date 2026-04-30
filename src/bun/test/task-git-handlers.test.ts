import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { taskGitHandlers } from "../handlers/task-git.ts";
import { registerProjectGitContext } from "../git/worktree.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let gitDir: string;
let worktreesBase: string;
let configCleanup: () => void;

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "railyn-git-"));
  worktreesBase = mkdtempSync(join(tmpdir(), "railyn-wt-"));
  const cfg = setupTestConfig(`worktree_base_path: "${worktreesBase}"`, gitDir);
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

// ─── TG-1: tasks.listBranches ─────────────────────────────────────────────────

describe("tasks.listBranches", () => {
  it("returns empty array when no git context row exists for the task", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    // No registerProjectGitContext call — task has no task_git_context row

    const handlers = taskGitHandlers(db, () => {});
    const result = await handlers["tasks.listBranches"]({ taskId });

    expect(result).toEqual({ branches: [] });
  });
});

// ─── TG-2: tasks.getChangedFiles (worktree not ready) ────────────────────────

describe("tasks.getChangedFiles", () => {
  it("returns empty array when worktree is not ready", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    registerProjectGitContext(taskId, gitDir);
    // worktree_status defaults to 'not_created' after registerProjectGitContext

    const handlers = taskGitHandlers(db, () => {});
    const result = await handlers["tasks.getChangedFiles"]({ taskId });

    expect(result).toEqual([]);
  });

  // ─── TG-3: tasks.getChangedFiles (worktree ready with untracked file) ────────

  it("returns untracked files when worktree is ready", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    registerProjectGitContext(taskId, gitDir);

    // Create a git worktree directory and mark it ready in the DB
    const wtPath = join(worktreesBase, `task-${taskId}`);
    mkdirSync(wtPath, { recursive: true });
    execSync(`git worktree add ${wtPath} -b task-${taskId}`, { cwd: gitDir });
    db.run(
      "UPDATE task_git_context SET worktree_path = ?, worktree_status = 'ready' WHERE task_id = ?",
      [wtPath, taskId],
    );

    // Add an untracked file to the worktree
    writeFileSync(join(wtPath, "new-file.ts"), "export const x = 1;");

    const handlers = taskGitHandlers(db, () => {});
    const result = await handlers["tasks.getChangedFiles"]({ taskId });

    expect(result).toContain("new-file.ts");
  });
});
