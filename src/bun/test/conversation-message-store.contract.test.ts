import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, makeTempDir } from "./helpers.ts";
import type { ConversationMessageStore, NewConversationMessageInput } from "../conversation/message-store.ts";
import { LegacySqliteConversationMessageStore } from "../conversation/legacy-sqlite-message-store.ts";
import { FileConversationMessageStore } from "../conversation/file-message-store.ts";

/**
 * Shared behavioral contract run against both `ConversationMessageStore` implementations.
 * Proves the two are interchangeable from every call site's perspective — a caller depending
 * only on the interface (via the resolver) can never observe which implementation it's using.
 */
function runContractTests(
  label: string,
  makeStore: () => { store: ConversationMessageStore; conversationId: number; cleanup: () => void },
) {
  describe(`ConversationMessageStore contract — ${label}`, () => {
    let store: ConversationMessageStore;
    let cleanup: () => void;

    beforeEach(() => {
      const created = makeStore();
      store = created.store;
      cleanup = created.cleanup;
    });

    afterEach(() => cleanup());

    function msg(overrides: Partial<NewConversationMessageInput> = {}): NewConversationMessageInput {
      return {
        taskId: null,
        type: "user",
        role: "user",
        content: "hello",
        metadata: null,
        ...overrides,
      };
    }

    it("append assigns a sequential id and persists all fields", async () => {
      const row1 = await store.append(msg({ content: "first" }));
      const row2 = await store.append(msg({ content: "second", type: "assistant", role: "assistant" }));
      expect(row1.id).toBe(1);
      expect(row2.id).toBe(2);
      expect(row1.content).toBe("first");
      expect(row2.type).toBe("assistant");
      expect(row2.role).toBe("assistant");
    });

    it("append persists metadata as a JSON string retrievable via getById", async () => {
      const row = await store.append(msg({ metadata: { toolCallId: "call_1" } }));
      const fetched = await store.getById(row.id);
      expect(fetched).not.toBeNull();
      expect(JSON.parse(fetched!.metadata ?? "{}")).toEqual({ toolCallId: "call_1" });
    });

    it("appendBatch persists messages in order with sequential ids", async () => {
      const rows = await store.appendBatch([
        msg({ content: "a" }),
        msg({ content: "b", type: "assistant", role: "assistant" }),
        msg({ content: "c" }),
      ]);
      expect(rows.map((r) => r.content)).toEqual(["a", "b", "c"]);
      expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    });

    it("getById returns null for a non-existent id", async () => {
      await store.append(msg());
      expect(await store.getById(999)).toBeNull();
    });

    it("getLastByType returns the most recent message of that type, or null", async () => {
      await store.append(msg({ type: "user", role: "user", content: "u1" }));
      await store.append(msg({ type: "assistant", role: "assistant", content: "a1" }));
      await store.append(msg({ type: "user", role: "user", content: "u2" }));

      const lastUser = await store.getLastByType("user");
      expect(lastUser?.content).toBe("u2");

      const lastCompaction = await store.getLastByType("compaction_summary");
      expect(lastCompaction).toBeNull();
    });

    it("getRange returns messages with id >= fromId ascending, respecting limit and excludeFromId", async () => {
      for (let i = 1; i <= 5; i++) {
        await store.append(msg({ content: `m${i}` }));
      }
      const fromThree = await store.getRange(3);
      expect(fromThree.map((r) => r.content)).toEqual(["m3", "m4", "m5"]);

      const limited = await store.getRange(1, { limit: 2 });
      expect(limited.map((r) => r.content)).toEqual(["m1", "m2"]);

      const excluded = await store.getRange(1, { excludeFromId: 4 });
      expect(excluded.map((r) => r.content)).toEqual(["m1", "m2", "m3"]);
    });

    it("getPage without beforeMessageId returns the newest `limit` messages, oldest-first, with hasMore", async () => {
      for (let i = 1; i <= 5; i++) {
        await store.append(msg({ content: `m${i}` }));
      }
      const page = await store.getPage({ limit: 2 });
      expect(page.rows.map((r) => r.content)).toEqual(["m4", "m5"]);
      expect(page.hasMore).toBe(true);
    });

    it("getPage with beforeMessageId returns the page just before that id, with correct hasMore", async () => {
      for (let i = 1; i <= 5; i++) {
        await store.append(msg({ content: `m${i}` }));
      }
      const page = await store.getPage({ beforeMessageId: 4, limit: 2 });
      expect(page.rows.map((r) => r.content)).toEqual(["m2", "m3"]);
      expect(page.hasMore).toBe(true);

      const firstPage = await store.getPage({ beforeMessageId: 3, limit: 10 });
      expect(firstPage.rows.map((r) => r.content)).toEqual(["m1", "m2"]);
      expect(firstPage.hasMore).toBe(false);
    });

    it("getAll returns all messages ascending, optionally filtered by type", async () => {
      await store.append(msg({ type: "user", role: "user", content: "u1" }));
      await store.append(msg({ type: "assistant", role: "assistant", content: "a1" }));
      await store.append(msg({ type: "user", role: "user", content: "u2" }));

      const all = await store.getAll();
      expect(all.map((r) => r.content)).toEqual(["u1", "a1", "u2"]);

      const usersOnly = await store.getAll({ types: ["user"] });
      expect(usersOnly.map((r) => r.content)).toEqual(["u1", "u2"]);
    });

    it("deleteAll removes all messages for the conversation", async () => {
      await store.append(msg());
      await store.append(msg());
      await store.deleteAll();
      expect(await store.getAll()).toEqual([]);
    });
  });
}

// ─── Legacy SQLite implementation ────────────────────────────────────────────

let sqliteDb: Database;
let sqliteConversationId: number;

runContractTests("LegacySqliteConversationMessageStore (in-memory DB)", () => {
  sqliteDb = initDb();
  const seeded = seedProjectAndTask(sqliteDb, "/tmp/fake-repo");
  sqliteConversationId = seeded.conversationId;
  const store = new LegacySqliteConversationMessageStore(sqliteDb, sqliteConversationId);
  return { store, conversationId: sqliteConversationId, cleanup: () => {} };
});

// ─── File-backed implementation ──────────────────────────────────────────────

runContractTests("FileConversationMessageStore (real tmpdir)", () => {
  const { dir, cleanup } = makeTempDir();
  const store = new FileConversationMessageStore(1, dir);
  return { store, conversationId: 1, cleanup };
});
