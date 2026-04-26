import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { conversationHandlers } from "../handlers/conversations.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let gitDir: string;
let configCleanup: () => void;

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "railyn-pg-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "README.md"), "hello");
  execSync("git add . && git commit -m init", { cwd: gitDir });

  db = initDb();
  const cfg = setupTestConfig("", gitDir);
  configCleanup = cfg.cleanup;
});

afterEach(() => {
  db.close();
  configCleanup();
  rmSync(gitDir, { recursive: true, force: true });
});

function seedMessages(taskId: number, conversationId: number, count: number) {
  for (let i = 1; i <= count; i++) {
    db.run(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'user', 'user', ?)",
      [taskId, conversationId, `msg-${i}`],
    );
  }
}

function getIds(contents: string[]): number[] {
  return contents.map((c) => {
    const row = db
      .query<{ id: number }, [string]>("SELECT id FROM conversation_messages WHERE content = ?")
      .get(c);
    return row!.id;
  });
}

describe("conversations.getMessages pagination", () => {
  it("P-1: returns all messages (ascending) when count <= limit", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    seedMessages(taskId, conversationId, 3);

    const handlers = conversationHandlers(null);
    const result = await handlers["conversations.getMessages"]({ conversationId });

    expect(result.messages).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    const contents = result.messages.map((m) => m.content);
    expect(contents).toEqual(["msg-1", "msg-2", "msg-3"]);
  });

  it("P-2: hasMore is true when total exceeds limit", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    seedMessages(taskId, conversationId, 55);

    const handlers = conversationHandlers(null);
    const result = await handlers["conversations.getMessages"]({ conversationId, limit: 50 });

    expect(result.messages).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    // should return newest 50 (msg-6 through msg-55)
    expect(result.messages[0].content).toBe("msg-6");
    expect(result.messages[49].content).toBe("msg-55");
  });

  it("P-3: messages are returned in ascending id order", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    seedMessages(taskId, conversationId, 10);

    const handlers = conversationHandlers(null);
    const result = await handlers["conversations.getMessages"]({ conversationId, limit: 10 });

    const ids = result.messages.map((m) => m.id);
    const sorted = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sorted);
  });

  it("P-4: cursor (beforeMessageId) returns older page without overlap", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    seedMessages(taskId, conversationId, 10);

    const handlers = conversationHandlers(null);

    // First page: newest 5
    const page1 = await handlers["conversations.getMessages"]({ conversationId, limit: 5 });
    expect(page1.messages).toHaveLength(5);
    expect(page1.hasMore).toBe(true);

    const oldestInPage1 = page1.messages[0].id;

    // Second page: 5 before the oldest in page1
    const page2 = await handlers["conversations.getMessages"]({
      conversationId,
      limit: 5,
      beforeMessageId: oldestInPage1,
    });
    expect(page2.messages).toHaveLength(5);
    expect(page2.hasMore).toBe(false);

    // No overlap
    const ids1 = new Set(page1.messages.map((m) => m.id));
    for (const m of page2.messages) {
      expect(ids1.has(m.id)).toBe(false);
    }

    // All page2 ids are less than oldest in page1
    for (const m of page2.messages) {
      expect(m.id).toBeLessThan(oldestInPage1);
    }
  });

  it("P-5: cursor with exactly limit messages returns hasMore false", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    seedMessages(taskId, conversationId, 10);

    const handlers = conversationHandlers(null);

    // Get the 6th message id to use as cursor
    const all = await handlers["conversations.getMessages"]({ conversationId, limit: 100 });
    const pivotId = all.messages[5].id; // 6th message

    // Asking for 5 messages before pivot should return exactly 5 (msg-1..msg-5) with hasMore=false
    const page = await handlers["conversations.getMessages"]({
      conversationId,
      limit: 5,
      beforeMessageId: pivotId,
    });
    expect(page.messages).toHaveLength(5);
    expect(page.hasMore).toBe(false);
  });

  it("P-6: empty conversation returns empty messages with hasMore false", async () => {
    const { conversationId } = seedProjectAndTask(db, gitDir);

    const handlers = conversationHandlers(null);
    const result = await handlers["conversations.getMessages"]({ conversationId });

    expect(result.messages).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it("P-7: messages from other conversations are never included in results", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    seedMessages(taskId, conversationId, 5);

    // Create a second conversation with its own messages
    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const otherConvId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (?, ?, 'user', 'user', ?)",
      [taskId, otherConvId, "other-msg"],
    );

    const handlers = conversationHandlers(null);
    const result = await handlers["conversations.getMessages"]({ conversationId });

    expect(result.messages.every((m) => m.conversationId === conversationId)).toBe(true);
    expect(result.messages.some((m) => m.content === "other-msg")).toBe(false);
  });
});
