/**
 * Unit tests for WorkingDirectoryResolver.
 *
 * ⚠️  REGRESSION GUARD — this invariant has broken three times.
 *
 * The CWD passed to engine.execute() (via WorkingDirectoryResolver) MUST use
 * the same priority as ClaudeEngine.listCommands():
 *   1. projectPath  (workspace.yaml — the sub-application directory)
 *   2. worktree_path (git worktree root — fallback)
 *
 * When a task lives inside a monorepo the worktree_path is the repo root while
 * projectPath points to the specific sub-application (e.g. applications/broker).
 * .claude/commands/ lives under the sub-application, so if worktree_path wins
 * Claude starts in the wrong directory and every slash command becomes
 * "Unknown skill" — even though the commands show up in autocomplete (because
 * listCommands already resolved via projectPath).
 *
 * If you ever change WorkingDirectoryResolver or listCommands, keep both in sync.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname, basename, relative } from "path";
import { tmpdir } from "os";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { resetConfig, loadConfig } from "../config/index.ts";
import { WorkingDirectoryResolver } from "../engine/execution/working-directory-resolver.ts";
import type { TaskRow } from "../db/row-types.ts";

const DELIVERY_WORKFLOW_YAML = [
  "id: delivery",
  "name: Delivery",
  "columns:",
  "  - id: backlog",
  "    label: Backlog",
  "    is_backlog: true",
  "  - id: plan",
  "    label: Plan",
  "    on_enter_prompt: 'Plan the task.'",
  "    stage_instructions: 'You are a planning assistant.'",
  "    allowed_transitions: [inprogress]",
  "  - id: done",
  "    label: Done",
].join("\n") + "\n";

function setupMonorepoConfig(
  projectDir: string,
  gitRootDir: string,
): { configDir: string; cleanup: () => void } {
  const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));
  const workflowsDir = join(configDir, "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  // Use the parent of gitRootDir as workspace_path so both projectDir and
  // gitRootDir resolve correctly (handles monorepo and outside-gitRoot cases).
  const workspacePath = dirname(gitRootDir);
  const relGitRoot = basename(gitRootDir);
  const relProject = relative(workspacePath, projectDir);
  writeFileSync(
    join(configDir, "workspace.test.yaml"),
    [
      "name: test",
      "engine:",
      "  type: copilot",
      "  model: copilot/mock-model",
      `workspace_path: ${workspacePath}`,
      "projects:",
      "  - key: test-project",
      "    name: Test Project",
      `    project_path: ${relProject}`,
      `    git_root_path: ${relGitRoot}`,
      "    default_branch: main",
    ].join("\n") + "\n",
  );
  writeFileSync(join(workflowsDir, "delivery.yaml"), DELIVERY_WORKFLOW_YAML);
  process.env.RAILYN_DB = ":memory:";
  process.env.RAILYN_CONFIG_DIR = configDir;
  process.env.RAILYN_SESSION_MEMORY_DIR = join(configDir, "tasks");
  resetConfig();
  loadConfig();
  return {
    configDir,
    cleanup: () => {
      rmSync(configDir, { recursive: true, force: true });
      delete process.env.RAILYN_DB;
      delete process.env.RAILYN_CONFIG_DIR;
      delete process.env.RAILYN_SESSION_MEMORY_DIR;
      resetConfig();
    },
  };
}

function getTaskRow(db: Database, taskId: number): TaskRow {
  return db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
}

describe("WorkingDirectoryResolver", () => {
  it("returns worktree_path when worktree is ready (single-repo)", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-proj-"));
    const worktreeDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));
    const localConfig = setupTestConfig("", projectDir);
    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, projectDir);
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'ready', 'test-branch')",
        [taskId, projectDir, worktreeDir],
      );
      expect(new WorkingDirectoryResolver().resolve(getTaskRow(localDb, taskId))).toBe(worktreeDir);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(worktreeDir, { recursive: true, force: true });
      localConfig.cleanup();
    }
  });

  it("returns worktree_path/subdir when worktree is ready (monorepo)", () => {
    const gitRootDir = mkdtempSync(join(tmpdir(), "railyn-gitroot-"));
    const projectDir = join(gitRootDir, "packages", "app");
    mkdirSync(projectDir, { recursive: true });
    const worktreeDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));
    const localConfig = setupMonorepoConfig(projectDir, gitRootDir);
    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, projectDir);
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'ready', 'test-branch')",
        [taskId, gitRootDir, worktreeDir],
      );
      expect(new WorkingDirectoryResolver().resolve(getTaskRow(localDb, taskId))).toBe(
        join(worktreeDir, "packages", "app"),
      );
    } finally {
      rmSync(gitRootDir, { recursive: true, force: true });
      rmSync(worktreeDir, { recursive: true, force: true });
      localConfig.cleanup();
    }
  });

  it("throws when projectPath is outside gitRootPath", () => {
    const gitRootDir = mkdtempSync(join(tmpdir(), "railyn-gitroot-"));
    const unrelatedDir = mkdtempSync(join(tmpdir(), "railyn-unrelated-"));
    const worktreeDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));
    const localConfig = setupMonorepoConfig(unrelatedDir, gitRootDir);
    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, unrelatedDir);
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'ready', 'test-branch')",
        [taskId, gitRootDir, worktreeDir],
      );
      expect(() =>
        new WorkingDirectoryResolver().resolve(getTaskRow(localDb, taskId)),
      ).toThrow("outside gitRootPath");
    } finally {
      rmSync(gitRootDir, { recursive: true, force: true });
      rmSync(unrelatedDir, { recursive: true, force: true });
      rmSync(worktreeDir, { recursive: true, force: true });
      localConfig.cleanup();
    }
  });

  it("falls back to projectPath when worktree is not yet created", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-proj-"));
    const localConfig = setupTestConfig("", projectDir);
    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, projectDir);
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'not_created', 'test-branch')",
        [taskId, projectDir, null],
      );
      expect(new WorkingDirectoryResolver().resolve(getTaskRow(localDb, taskId))).toBe(projectDir);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      localConfig.cleanup();
    }
  });

  it("falls back to worktree_path when projectPath is not configured", () => {
    const worktreeDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));
    const localConfig = setupTestConfig("", worktreeDir);
    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, worktreeDir);
      localDb.run("UPDATE tasks SET project_key = 'no-project-path' WHERE id = ?", [taskId]);
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'ready', 'test-branch')",
        [taskId, worktreeDir, worktreeDir],
      );
      expect(new WorkingDirectoryResolver().resolve(getTaskRow(localDb, taskId))).toBe(worktreeDir);
    } finally {
      rmSync(worktreeDir, { recursive: true, force: true });
      localConfig.cleanup();
    }
  });
});
