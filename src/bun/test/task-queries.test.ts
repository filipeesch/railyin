import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/db.ts";
import { fetchChatSessionWithModel, fetchTaskWithModel } from "../db/task-queries.ts";
import { initDb, seedProjectAndTask } from "./helpers.ts";

let db: Db;

beforeEach(async () => {
  db = await initDb();
});

describe("task-queries helpers", () => {
  it("TQ-1/TQ-2/TQ-3: fetchTaskWithModel returns model, null, and null on missing id", async () => {
    const { taskId, conversationId } = await seedProjectAndTask(db, "/tmp/git");
    await db.exec("UPDATE conversations SET model = 'test/model' WHERE id = $1", [conversationId]);

    const withModel = await fetchTaskWithModel(db, taskId);
    expect(withModel?.model).toBe("test/model");

    await db.exec("UPDATE conversations SET model = NULL WHERE id = $1", [conversationId]);
    const withNullModel = await fetchTaskWithModel(db, taskId);
    expect(withNullModel?.model).toBeNull();

    expect(await fetchTaskWithModel(db, 999999)).toBeNull();
  });

  it("TQ-4: fetchTaskWithModel includes git context columns", async () => {
    const { taskId } = await seedProjectAndTask(db, "/tmp/git");
    await db.exec(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES ($1, $2, $3, $4, $5)",
      [taskId, "/tmp/git-root", "/wt/1", "ready", "main"],
    );

    const task = await fetchTaskWithModel(db, taskId);
    expect(task?.worktreePath).toBe("/wt/1");
    expect(task?.worktreeStatus).toBe("ready");
    expect(task?.branchName).toBe("main");
  });

  it("TQ-5/TQ-6/TQ-7: fetchChatSessionWithModel returns model, null, and null on missing id", async () => {
    const conv = await db.get<{ id: number }>(
      "INSERT INTO conversations (task_id, model) VALUES (NULL, 'test/model') RETURNING id",
    );
    const conversationId = conv!.id;
    const session = await db.get<{ id: number }>(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', $1) RETURNING id",
      [conversationId],
    );
    const sessionId = session!.id;

    const withModel = await fetchChatSessionWithModel(db, sessionId);
    expect(withModel?.model).toBe("test/model");

    await db.exec("UPDATE conversations SET model = NULL WHERE id = $1", [conversationId]);
    const withNullModel = await fetchChatSessionWithModel(db, sessionId);
    expect(withNullModel?.model).toBeNull();

    expect(await fetchChatSessionWithModel(db, 999999)).toBeNull();
  });
});
