import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { codeReviewHandlers } from "../handlers/code-review.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let taskId: number;
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

  ({ taskId } = seedProjectAndTask(db, gitDir));
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  rmSync(worktreesBase, { recursive: true, force: true });
  configCleanup();
});

// ─── CR-1: tasks.getCheckpointRef ─────────────────────────────────────────────

describe("tasks.getCheckpointRef", () => {
  it("returns null when no git context or checkpoint row exists", async () => {
    const handlers = codeReviewHandlers(db);
    const result = await handlers["tasks.getCheckpointRef"]({ taskId });

    expect(result).toBeNull();
  });
});

// ─── CR-2: tasks.getPendingHunkSummary ────────────────────────────────────────

describe("tasks.getPendingHunkSummary", () => {
  it("returns empty array when no hunk decisions exist", async () => {
    const handlers = codeReviewHandlers(db);
    const result = await handlers["tasks.getPendingHunkSummary"]({ taskId });

    expect(result).toEqual([]);
  });
});

// ─── CR-3: tasks.addLineComment + tasks.getLineComments ──────────────────────
// task_line_comments is created by initDb() with col_start / col_end columns

describe("tasks.addLineComment / tasks.getLineComments", () => {
  it("stores a comment and retrieves it via getLineComments", async () => {
    const handlers = codeReviewHandlers(db);

    await handlers["tasks.addLineComment"]({
      taskId,
      filePath: "src/foo.ts",
      lineStart: 1,
      lineEnd: 3,
      lineText: ["const x = 1;", "const y = 2;", "const z = 3;"],
      contextLines: [],
      comment: "Fix this",
    });

    const comments = await handlers["tasks.getLineComments"]({ taskId });

    expect(comments).toHaveLength(1);
    expect(comments[0].filePath).toBe("src/foo.ts");
    expect(comments[0].lineStart).toBe(1);
    expect(comments[0].lineEnd).toBe(3);
    expect(comments[0].comment).toBe("Fix this");
  });
});

// ─── CR-4: tasks.deleteLineComment ────────────────────────────────────────────

describe("tasks.deleteLineComment", () => {
  it("removes the comment so getLineComments returns empty", async () => {
    const handlers = codeReviewHandlers(db);

    const added = await handlers["tasks.addLineComment"]({
      taskId,
      filePath: "src/bar.ts",
      lineStart: 5,
      lineEnd: 5,
      lineText: ["doSomething();"],
      contextLines: [],
      comment: "Remove this call",
    });

    await handlers["tasks.deleteLineComment"]({ taskId, commentId: added.id });

    const comments = await handlers["tasks.getLineComments"]({ taskId });
    expect(comments).toHaveLength(0);
  });
});

// ─── CR-5: tasks.writeFile ────────────────────────────────────────────────────

describe("tasks.writeFile", () => {
  it("writes content to the worktree path on disk", async () => {
    const wtPath = join(worktreesBase, `task-${taskId}`);
    mkdirSync(wtPath, { recursive: true });
    execSync(`git worktree add ${wtPath} -b task-${taskId}`, { cwd: gitDir });
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
      [taskId, gitDir, wtPath],
    );

    const handlers = codeReviewHandlers(db);
    await handlers["tasks.writeFile"]({ taskId, filePath: "output.txt", content: "hello" });

    const written = readFileSync(join(wtPath, "output.txt"), "utf8");
    expect(written).toBe("hello");
  });
});
