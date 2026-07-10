import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ConversationMessageRow } from "../db/row-types.ts";
import type { ConversationMessageStore, NewConversationMessageInput } from "../conversation/message-store.ts";
import {
  buildRecentMessagesDigest,
  formatSessionNotesBlock,
  getSessionMemoryPath,
  readSessionMemory,
  writeSessionMemory,
  SESSION_MEMORY_MAX_CHARS,
} from "../workflow/session-memory.ts";

/**
 * First-ever unit tests for `session-memory.ts`. `buildRecentMessagesDigest` was extracted
 * (task 2.8/2.9) as a pure function over an injected `ConversationMessageStore` — no
 * `Database`/global state — specifically so it could be unit tested with a fake store, per
 * the locked decision for this task.
 */
class FakeConversationMessageStore implements ConversationMessageStore {
  private rows: ConversationMessageRow[] = [];
  private nextId = 1;

  constructor(seed: Partial<ConversationMessageRow>[] = []) {
    for (const s of seed) {
      this.rows.push({
        id: this.nextId++,
        task_id: s.task_id ?? null,
        conversation_id: s.conversation_id ?? 1,
        type: s.type ?? "user",
        role: s.role ?? null,
        content: s.content ?? "",
        metadata: s.metadata ?? null,
        created_at: s.created_at ?? new Date().toISOString(),
      });
    }
  }

  async append(input: NewConversationMessageInput): Promise<ConversationMessageRow> {
    const row: ConversationMessageRow = {
      id: this.nextId++,
      task_id: input.taskId,
      conversation_id: 1,
      type: input.type,
      role: input.role,
      content: input.content,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async appendBatch(inputs: NewConversationMessageInput[]): Promise<ConversationMessageRow[]> {
    const out: ConversationMessageRow[] = [];
    for (const input of inputs) out.push(await this.append(input));
    return out;
  }

  async getById(id: number): Promise<ConversationMessageRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async getLastByType(type: string): Promise<ConversationMessageRow | null> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].type === type) return this.rows[i];
    }
    return null;
  }

  async getRange(fromId: number): Promise<ConversationMessageRow[]> {
    return this.rows.filter((r) => r.id >= fromId);
  }

  async getPage(opts: { beforeMessageId?: number; limit: number }): Promise<{ rows: ConversationMessageRow[]; hasMore: boolean }> {
    const rows = this.rows.slice(-opts.limit);
    return { rows, hasMore: false };
  }

  async getAll(filter?: { types?: string[] }): Promise<ConversationMessageRow[]> {
    if (filter?.types && filter.types.length > 0) {
      const typeSet = new Set(filter.types);
      return this.rows.filter((r) => typeSet.has(r.type));
    }
    return this.rows;
  }

  async deleteAll(): Promise<void> {
    this.rows = [];
  }
}

describe("buildRecentMessagesDigest", () => {
  it("formats user/assistant/tool_call/tool_result messages into a readable digest", async () => {
    const store = new FakeConversationMessageStore([
      { type: "user", content: "please fix the bug" },
      { type: "assistant", content: "I found the issue" },
      { type: "tool_call", content: JSON.stringify({ name: "edit_file" }) },
      { type: "tool_result", content: "file edited successfully" },
    ]);

    const digest = await buildRecentMessagesDigest(store);

    expect(digest).toContain("User: please fix the bug");
    expect(digest).toContain("Assistant: I found the issue");
    expect(digest).toContain("Tool call: edit_file");
    expect(digest).toContain("Tool result: file edited successfully");
  });

  it("excludes message types not in the digest allow-list (e.g. compaction_summary)", async () => {
    const store = new FakeConversationMessageStore([
      { type: "user", content: "hello" },
      { type: "compaction_summary", content: "irrelevant summary" },
    ]);

    const digest = await buildRecentMessagesDigest(store);

    expect(digest).toContain("User: hello");
    expect(digest).not.toContain("irrelevant summary");
  });

  it("bounds the digest to the most recent `limit` matching messages", async () => {
    const seed = Array.from({ length: 10 }, (_, i) => ({ type: "user" as const, content: `msg-${i}` }));
    const store = new FakeConversationMessageStore(seed);

    const digest = await buildRecentMessagesDigest(store, 3);

    expect(digest).not.toContain("msg-6");
    expect(digest).toContain("msg-7");
    expect(digest).toContain("msg-8");
    expect(digest).toContain("msg-9");
  });

  it("returns an empty string when the store has no matching messages", async () => {
    const store = new FakeConversationMessageStore();
    const digest = await buildRecentMessagesDigest(store);
    expect(digest).toBe("");
  });

  it("truncates tool_result content to 200 characters", async () => {
    const longContent = "x".repeat(500);
    const store = new FakeConversationMessageStore([{ type: "tool_result", content: longContent }]);

    const digest = await buildRecentMessagesDigest(store);

    expect(digest).toBe(`Tool result: ${longContent.slice(0, 200)}`);
  });

  it("falls back to a generic label when tool_call content isn't valid JSON", async () => {
    const store = new FakeConversationMessageStore([{ type: "tool_call", content: "not-json" }]);
    const digest = await buildRecentMessagesDigest(store);
    expect(digest).toBe("Tool call");
  });
});

describe("formatSessionNotesBlock", () => {
  it("wraps notes in a session_context XML block", () => {
    const block = formatSessionNotesBlock("some notes");
    expect(block).toBe("\n\n<session_context>\nsome notes\n</session_context>");
  });

  it("truncates from the top when notes exceed SESSION_MEMORY_MAX_CHARS", () => {
    const notes = "a".repeat(SESSION_MEMORY_MAX_CHARS + 100);
    const block = formatSessionNotesBlock(notes);
    // The kept content should be exactly the last SESSION_MEMORY_MAX_CHARS characters.
    expect(block).toBe(`\n\n<session_context>\n${notes.slice(100)}\n</session_context>`);
  });
});

describe("session memory file I/O", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "railyn-session-memory-"));
    process.env.RAILYN_SESSION_MEMORY_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.RAILYN_SESSION_MEMORY_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("readSessionMemory returns null when no notes file exists yet", () => {
    expect(readSessionMemory(123)).toBeNull();
  });

  it("writeSessionMemory then readSessionMemory round-trips the content", () => {
    writeSessionMemory(456, "## Notes\n\nSome content");
    expect(readSessionMemory(456)).toBe("## Notes\n\nSome content");
  });

  it("writeSessionMemory writes atomically (no dangling .tmp file left behind)", () => {
    writeSessionMemory(789, "content");
    const path = getSessionMemoryPath(789);
    expect(path.endsWith(".tmp")).toBe(false);
    // Overwrite to exercise the temp-file+rename path a second time.
    writeSessionMemory(789, "updated content");
    expect(readSessionMemory(789)).toBe("updated content");
  });
});
