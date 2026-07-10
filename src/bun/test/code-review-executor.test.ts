import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "bun:sqlite";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetConfig } from "../config/index.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { CodeReviewExecutor } from "../engine/execution/code-review-executor.ts";
import { CustomPromptInjector } from "../engine/execution/custom-prompt-injector.ts";
import { initDb, makeTestRegistry, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { CapturingParamsBuilder, StubStreamProcessor, StubWorkdirResolver, TestEngine } from "./executor-test-helpers.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;
let wsRepo: WorkspaceRepository;
let boardTools: BoardToolExecutor;

beforeEach(() => {
  db = initDb();
  wsRepo = new WorkspaceRepository(db);
  boardTools = new BoardToolExecutor(db, wsRepo);
  gitDir = mkdtempSync(join(tmpdir(), "railyn-crx-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;\n");
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup?.();
  resetConfig();
});

describe("CodeReviewExecutor", () => {
  it("CR-MODEL-1: onTaskUpdated receives task with model from conversation", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'fake/fake' WHERE id = (SELECT conversation_id FROM tasks WHERE id = ?)", [taskId]);
    db.run(
      "INSERT INTO task_hunk_decisions (task_id, hunk_hash, file_path, reviewer_id, decision, original_start, original_end, modified_start, modified_end) VALUES (?, 'h1', 'index.ts', 'user', 'approved', 1, 1, 1, 1)",
      [taskId],
    );

    const updates: import("../../shared/rpc-types.ts").Task[] = [];
    const executor = new CodeReviewExecutor(
      db,
      makeTestRegistry(new TestEngine()),
      new CapturingParamsBuilder(),
      new StubWorkdirResolver(gitDir),
      new StubStreamProcessor(),
      (task) => updates.push(task),
      () => {},
      wsRepo,
      boardTools,
      new CustomPromptInjector(),
    );

    await executor.execute(taskId);
    expect(updates.at(-1)?.model).toBe("fake/fake");
  });
});
