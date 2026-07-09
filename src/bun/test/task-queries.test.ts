import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "bun:sqlite";
import { fetchChatSessionWithModel, fetchTaskWithModel } from "../db/task-queries.ts";
import { initDb, seedProjectAndTask } from "./helpers.ts";

let db: Database;

beforeEach(() => {
  db = initDb();
});

describe("task-queries helpers", () => {
  it("TQ-1/TQ-2/TQ-3: fetchTaskWithModel returns model, null, and null on missing id", () => {
    const { taskId, conversationId } = seedProjectAndTask(db, "/tmp/git");
    db.run("UPDATE conversations SET model = 'test/model' WHERE id = ?", [conversationId]);

    const withModel = fetchTaskWithModel(db, taskId);
    expect(withModel?.model).toBe("test/model");

    db.run("UPDATE conversations SET model = NULL WHERE id = ?", [conversationId]);
    const withNullModel = fetchTaskWithModel(db, taskId);
    expect(withNullModel?.model).toBeNull();

    expect(fetchTaskWithModel(db, 999999)).toBeNull();
  });

  it("TQ-4: fetchTaskWithModel includes git context columns", () => {
    const { taskId } = seedProjectAndTask(db, "/tmp/git");
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, ?, ?)",
      [taskId, "/tmp/git-root", "/wt/1", "ready", "main"],
    );

    const task = fetchTaskWithModel(db, taskId);
    expect(task?.worktreePath).toBe("/wt/1");
    expect(task?.worktreeStatus).toBe("ready");
    expect(task?.branchName).toBe("main");
  });

  it("TQ-5/TQ-6/TQ-7: fetchChatSessionWithModel returns model, null, and null on missing id", () => {
    db.run("INSERT INTO conversations (task_id, model) VALUES (NULL, 'test/model')");
    const conversationId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    db.run(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', ?)",
      [conversationId],
    );
    const sessionId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;

    const withModel = fetchChatSessionWithModel(db, sessionId);
    expect(withModel?.model).toBe("test/model");

    db.run("UPDATE conversations SET model = NULL WHERE id = ?", [conversationId]);
    const withNullModel = fetchChatSessionWithModel(db, sessionId);
    expect(withNullModel?.model).toBeNull();

    expect(fetchChatSessionWithModel(db, 999999)).toBeNull();
  });
});
