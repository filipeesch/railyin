import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { taskHandlers } from "../handlers/tasks.ts";
import { formatReviewMessageForLLM } from "../workflow/review.ts";
import { compactMessages } from "../workflow/engine.ts";
import type { Database } from "bun:sqlite";
import type { CodeReviewPayload } from "../../shared/rpc-types.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;

beforeEach(() => {
  db = initDb();
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;

  gitDir = mkdtempSync(join(tmpdir(), "railyn-review-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  // Initial commit with a file
  writeFileSync(join(gitDir, "app.ts"), 'const x = 1;\nconst y = 2;\nconst z = 3;\n');
  execSync("git add . && git commit -m init", { cwd: gitDir });
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup();
});

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeHandlers() {
  return taskHandlers(
    () => { },
    () => { },
    () => { },
    () => { },
  );
}

/** Insert task_git_context pointing to gitDir as both root and worktree. */
function seedGitContext(taskId: number, status: string = "ready") {
  db.run(
    `INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name)
     VALUES (?, ?, ?, ?, 'test-branch')`,
    [taskId, gitDir, gitDir, status],
  );
}

// ─── tasks.getChangedFiles ────────────────────────────────────────────────────

describe("tasks.getChangedFiles", () => {
  it("returns empty array for a clean worktree", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    const files = await handlers["tasks.getChangedFiles"]({ taskId });
    expect(files).toEqual([]);
  });

  it("returns changed file paths when worktree has modifications", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    // Modify the tracked file (uncommitted change vs HEAD)
    writeFileSync(join(gitDir, "app.ts"), 'const x = 99;\nconst y = 2;\nconst z = 3;\n');

    const files = await handlers["tasks.getChangedFiles"]({ taskId });
    expect(files).toContain("app.ts");
  });

  it("returns [] when worktree is not ready", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId, "not_created");
    const handlers = makeHandlers();

    const files = await handlers["tasks.getChangedFiles"]({ taskId });
    expect(files).toEqual([]);
  });

  it("returns new (untracked staged) file paths", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    // Add and stage a new file (but don't commit)
    writeFileSync(join(gitDir, "newfile.ts"), 'export const val = 42;\n');
    execSync("git add newfile.ts", { cwd: gitDir });

    const files = await handlers["tasks.getChangedFiles"]({ taskId });
    expect(files).toContain("newfile.ts");
  });
});

// ─── tasks.getFileDiff ────────────────────────────────────────────────────────

describe("tasks.getFileDiff", () => {
  it("returns original from HEAD and modified from working tree", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    writeFileSync(join(gitDir, "app.ts"), 'const x = 99;\nconst y = 2;\nconst z = 3;\n');

    const diff = await handlers["tasks.getFileDiff"]({ taskId, filePath: "app.ts" });
    expect(diff.original).toContain("const x = 1;");
    expect(diff.modified).toContain("const x = 99;");
  });

  it("returns empty string as original for a new file", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    writeFileSync(join(gitDir, "brand-new.ts"), 'export const n = 5;\n');

    const diff = await handlers["tasks.getFileDiff"]({ taskId, filePath: "brand-new.ts" });
    expect(diff.original).toBe("");
    expect(diff.modified).toContain("export const n = 5;");
  });
});

// ─── tasks.rejectHunk ────────────────────────────────────────────────────────

describe("tasks.rejectHunk", () => {
  it("reverts a single-hunk change and returns updated diff", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    // Change the first line only (one hunk)
    writeFileSync(join(gitDir, "app.ts"), 'const x = 999;\nconst y = 2;\nconst z = 3;\n');

    const result = await handlers["tasks.rejectHunk"]({ taskId, filePath: "app.ts", hunkIndex: 0 });

    // After reverting hunk 0, the file should be back to HEAD content
    const reverted = await Bun.file(join(gitDir, "app.ts")).text();
    expect(reverted).toContain("const x = 1;");

    // Returned diff should show no difference (original == modified after revert)
    expect(result.modified).toContain("const x = 1;");
  });

  it("throws when hunk index is out of range", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    writeFileSync(join(gitDir, "app.ts"), 'const x = 999;\nconst y = 2;\nconst z = 3;\n');

    await expect(
      handlers["tasks.rejectHunk"]({ taskId, filePath: "app.ts", hunkIndex: 99 }),
    ).rejects.toThrow();
  });
});

// ─── formatReviewMessageForLLM ───────────────────────────────────────────────

describe("formatReviewMessageForLLM", () => {
  it("produces minimal message when all hunks are accepted", () => {
    const payload: CodeReviewPayload = {
      taskId: 1,
      files: [
        {
          path: "app.ts",
          hunks: [{ hunkIndex: 0, originalRange: [1, 3], modifiedRange: [1, 3], decision: "accepted", comment: null }],
        },
      ],
    };
    const msg = formatReviewMessageForLLM(payload);
    expect(msg).toContain("=== Code Review ===");
    expect(msg).not.toContain("REJECTED");
    expect(msg).not.toContain("CHANGE REQUESTED");
    expect(msg).toContain("accepted");
  });

  it("includes rejected hunks with default comment when no comment is provided", () => {
    const payload: CodeReviewPayload = {
      taskId: 1,
      files: [
        {
          path: "app.ts",
          hunks: [{ hunkIndex: 0, originalRange: [1, 3], modifiedRange: [1, 3], decision: "rejected", comment: null }],
        },
      ],
    };
    const msg = formatReviewMessageForLLM(payload);
    expect(msg).toContain("REJECTED");
    expect(msg).toContain("already reverted");
    expect(msg).toContain("The user explicitly rejected this change");
  });

  it("includes rejected hunks with user comment when provided", () => {
    const payload: CodeReviewPayload = {
      taskId: 1,
      files: [
        {
          path: "app.ts",
          hunks: [{ hunkIndex: 0, originalRange: [1, 3], modifiedRange: [1, 3], decision: "rejected", comment: "Too many globals" }],
        },
      ],
    };
    const msg = formatReviewMessageForLLM(payload);
    expect(msg).toContain("Too many globals");
  });

  it("includes change_request hunks with comment", () => {
    const payload: CodeReviewPayload = {
      taskId: 1,
      files: [
        {
          path: "app.ts",
          hunks: [{ hunkIndex: 0, originalRange: [1, 3], modifiedRange: [1, 3], decision: "change_request", comment: "Use const instead of let" }],
        },
      ],
    };
    const msg = formatReviewMessageForLLM(payload);
    expect(msg).toContain("CHANGE REQUESTED");
    expect(msg).toContain("Use const instead of let");
  });
});

// ─── compactMessages excludes code_review ────────────────────────────────────

describe("compactMessages", () => {
  it("excludes code_review messages from LLM history", () => {
    const msgs = [
      { id: 1, type: "user", role: "user", content: "Plan the task", taskId: 1, conversationId: 1, createdAt: "" },
      { id: 2, type: "assistant", role: "assistant", content: "Here is my plan", taskId: 1, conversationId: 1, createdAt: "" },
      { id: 3, type: "code_review", role: "user", content: '{"taskId":1,"files":[]}', taskId: 1, conversationId: 1, createdAt: "" },
      { id: 4, type: "user", role: "user", content: "Looks good", taskId: 1, conversationId: 1, createdAt: "" },
    ] as any[];

    const result = compactMessages(msgs);
    const contents = result.map((m) => m.content);
    // code_review content should not appear in the compacted output
    expect(contents).not.toContain('{"taskId":1,"files":[]}');
    // regular user/assistant messages should still be included
    expect(contents).toContain("Plan the task");
    expect(contents).toContain("Here is my plan");
    expect(contents).toContain("Looks good");
  });
});

// ─── tasks.setHunkDecision ────────────────────────────────────────────────────

describe("tasks.setHunkDecision", () => {
  it("inserts a new hunk decision and upserts on second call", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    await handlers["tasks.setHunkDecision"]({
      taskId,
      hunkHash: "abc123",
      filePath: "app.ts",
      decision: "accepted",
      comment: null,
      originalStart: 1,
      originalEnd: 3,
      modifiedStart: 1,
      modifiedEnd: 3,
    });

    const row = db
      .query<{ decision: string; comment: string | null }, [number, string]>(
        "SELECT decision, comment FROM task_hunk_decisions WHERE task_id = ? AND hunk_hash = ?",
      )
      .get(taskId, "abc123");
    expect(row?.decision).toBe("accepted");
    expect(row?.comment).toBeNull();

    // Upsert: change to change_request with comment
    await handlers["tasks.setHunkDecision"]({
      taskId,
      hunkHash: "abc123",
      filePath: "app.ts",
      decision: "change_request",
      comment: "Use const",
      originalStart: 1,
      originalEnd: 3,
      modifiedStart: 1,
      modifiedEnd: 3,
    });

    const updated = db
      .query<{ decision: string; comment: string | null }, [number, string]>(
        "SELECT decision, comment FROM task_hunk_decisions WHERE task_id = ? AND hunk_hash = ?",
      )
      .get(taskId, "abc123");
    expect(updated?.decision).toBe("change_request");
    expect(updated?.comment).toBe("Use const");
  });
});

// ─── tasks.getFileDiff hunk enrichment ───────────────────────────────────────

describe("tasks.getFileDiff hunk enrichment", () => {
  it("returns hunks with decisions joined from DB; missing decision defaults to pending", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    // Modify a file so there's a diff
    writeFileSync(join(gitDir, "app.ts"), 'const x = 999;\nconst y = 2;\nconst z = 3;\n');

    const result = await handlers["tasks.getFileDiff"]({ taskId, filePath: "app.ts" });
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].humanDecision).toBe("pending");
    expect(result.hunks[0].hash).toBeTruthy();

    // Store a decision for that hash
    await handlers["tasks.setHunkDecision"]({
      taskId,
      hunkHash: result.hunks[0].hash,
      filePath: "app.ts",
      decision: "accepted",
      comment: null,
      originalStart: result.hunks[0].originalStart,
      originalEnd: result.hunks[0].originalEnd,
      modifiedStart: result.hunks[0].modifiedStart,
      modifiedEnd: result.hunks[0].modifiedEnd,
    });

    // Reload — should now show accepted
    const updated = await handlers["tasks.getFileDiff"]({ taskId, filePath: "app.ts" });
    expect(updated.hunks[0].humanDecision).toBe("accepted");
  });
});

// ─── handleCodeReview reads decisions from DB ─────────────────────────────────

describe("handleCodeReview DB read", () => {
  it("builds payload from task_hunk_decisions table without frontend payload", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    const handlers = makeHandlers();

    // Seed a hunk decision
    db.run(
      `INSERT INTO task_hunk_decisions (task_id, hunk_hash, file_path, reviewer_type, reviewer_id, decision, comment, original_start, modified_start)
       VALUES (?, 'deadbeef', 'app.ts', 'human', 'user', 'change_request', 'fix this', 1, 1)`,
      [taskId],
    );

    // Trigger sendMessage with code_review type (no payload)
    let capturedMessageContent: string | null = null;
    const { message } = await handlers["tasks.sendMessage"]({ taskId, content: JSON.stringify({ _type: "code_review" }) });

    expect(message.type).toBe("code_review");
    // The stored content should include the file path from DB
    const payload: CodeReviewPayload = JSON.parse(message.content);
    expect(payload.files.some((f: any) => f.path === "app.ts")).toBe(true);
  });
});
