import { describe, it, expect, beforeEach } from "vitest";
import { initDb, seedProjectAndTask } from "./helpers.ts";
import { TaskGitContextRepository } from "../db/repositories/TaskGitContextRepository.ts";
import type { Db } from "../db/db.ts";

let db: Db;
let repo: TaskGitContextRepository;

beforeEach(async () => {
  db = await initDb();
  repo = new TaskGitContextRepository(db);
});

// ─── TGCR-1: upsertContext ────────────────────────────────────────────────────

describe("upsertContext", () => {
  it("creates row with worktree_status = 'not_created'", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");

    await repo.upsertContext(taskId, "/some/path");

    const row = await db
      .get<{ worktree_status: string }>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = $1",
        [taskId],
      );

    expect(row).not.toBeUndefined();
    expect(row!.worktree_status).toBe("not_created");
  });

  it("creates row with provided git_root_path and null subrepo_path by default", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");

    await repo.upsertContext(taskId, "/root/path");

    const row = await db
      .get<{ git_root_path: string; subrepo_path: string | null }>(
        "SELECT git_root_path, subrepo_path FROM task_git_context WHERE task_id = $1",
        [taskId],
      );

    expect(row!.git_root_path).toBe("/root/path");
    expect(row!.subrepo_path).toBeNull();
  });

  it("creates row with subrepo_path when provided", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");

    await repo.upsertContext(taskId, "/root/path", "packages/sub");

    const row = await db
      .get<{ subrepo_path: string | null }>(
        "SELECT subrepo_path FROM task_git_context WHERE task_id = $1",
        [taskId],
      );

    expect(row!.subrepo_path).toBe("packages/sub");
  });

  it("updates git_root_path when row already exists, without resetting worktree_status", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");

    await repo.upsertContext(taskId, "/original/path");
    // Manually advance status to simulate a worktree being created
    await db.exec("UPDATE task_git_context SET worktree_status = 'ready' WHERE task_id = $1", [taskId]);

    // Re-upsert with a different path
    await repo.upsertContext(taskId, "/new/path");

    const row = await db
      .get<{ git_root_path: string; worktree_status: string }>(
        "SELECT git_root_path, worktree_status FROM task_git_context WHERE task_id = $1",
        [taskId],
      );

    expect(row!.git_root_path).toBe("/new/path");
    expect(row!.worktree_status).toBe("ready"); // not reset to 'not_created'
  });
});

// ─── TGCR-2: getContext ───────────────────────────────────────────────────────

describe("getContext", () => {
  it("returns null when no row exists for the task", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");

    const result = await repo.getContext(taskId);

    expect(result).toBeNull();
  });

  it("returns full mapped context when row exists", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");
    await repo.upsertContext(taskId, "/root/path", "sub");

    const result = await repo.getContext(taskId);

    expect(result).not.toBeNull();
    expect(result!.taskId).toBe(taskId);
    expect(result!.gitRootPath).toBe("/root/path");
    expect(result!.subrepoPath).toBe("sub");
    expect(result!.worktreeStatus).toBe("not_created");
    expect(result!.worktreePath).toBeNull();
    expect(result!.branchName).toBeNull();
    expect(result!.baseSha).toBeNull();
  });
});

// ─── TGCR-3: status mutations ────────────────────────────────────────────────

describe("updateStatus", () => {
  it("changes worktree_status to the given value", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");
    await repo.upsertContext(taskId, "/some/path");

    await repo.updateStatus(taskId, "creating");

    const row = await db
      .get<{ worktree_status: string }>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = $1",
        [taskId],
      );
    expect(row!.worktree_status).toBe("creating");
  });
});

describe("updateCreating", () => {
  it("sets status to 'creating', worktree_path, and branch_name", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");
    await repo.upsertContext(taskId, "/some/path");

    await repo.updateCreating(taskId, "/worktrees/task-1", "task-1");

    const row = await db
      .get<{ worktree_status: string; worktree_path: string; branch_name: string }>(
        "SELECT worktree_status, worktree_path, branch_name FROM task_git_context WHERE task_id = $1",
        [taskId],
      );
    expect(row!.worktree_status).toBe("creating");
    expect(row!.worktree_path).toBe("/worktrees/task-1");
    expect(row!.branch_name).toBe("task-1");
  });
});

describe("updateReady", () => {
  it("sets status to 'ready' and records baseSha", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");
    await repo.upsertContext(taskId, "/some/path");

    await repo.updateReady(taskId, "abc123");

    const row = await db
      .get<{ worktree_status: string; base_sha: string | null }>(
        "SELECT worktree_status, base_sha FROM task_git_context WHERE task_id = $1",
        [taskId],
      );
    expect(row!.worktree_status).toBe("ready");
    expect(row!.base_sha).toBe("abc123");
  });

  it("accepts null baseSha", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");
    await repo.upsertContext(taskId, "/some/path");

    await repo.updateReady(taskId, null);

    const row = await db
      .get<{ base_sha: string | null }>(
        "SELECT base_sha FROM task_git_context WHERE task_id = $1",
        [taskId],
      );
    expect(row!.base_sha).toBeNull();
  });
});

describe("updateRemoved", () => {
  it("sets status to 'removed'", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/fake-git");
    await repo.upsertContext(taskId, "/some/path");

    await repo.updateRemoved(taskId);

    const row = await db
      .get<{ worktree_status: string }>(
        "SELECT worktree_status FROM task_git_context WHERE task_id = $1",
        [taskId],
      );
    expect(row!.worktree_status).toBe("removed");
  });
});
