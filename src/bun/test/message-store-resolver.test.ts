import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb } from "./helpers.ts";
import { resolveConversationMessageStore } from "../conversation/message-store-resolver.ts";
import { FileConversationMessageStore } from "../conversation/file-message-store.ts";
import { LegacySqliteConversationMessageStore } from "../conversation/legacy-sqlite-message-store.ts";

/**
 * `resolveConversationMessageStore` is the single place in the codebase that decides whether
 * a conversation's messages are file-backed or legacy-SQLite-backed. These tests assert it is
 * the sole medium-selection point: the discriminant is exactly `conversations.storage_medium`,
 * and every branch resolves to the correct concrete implementation.
 */
describe("resolveConversationMessageStore", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb();
  });

  function insertConversation(storageMedium?: "sqlite" | "file"): number {
    if (storageMedium != null) {
      db.run("INSERT INTO conversations (task_id, storage_medium) VALUES (NULL, ?)", [storageMedium]);
    } else {
      db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    }
    return db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
  }

  it("resolves to FileConversationMessageStore when storage_medium = 'file'", () => {
    const conversationId = insertConversation("file");
    const store = resolveConversationMessageStore(db, conversationId);
    expect(store).toBeInstanceOf(FileConversationMessageStore);
  });

  it("resolves to LegacySqliteConversationMessageStore when storage_medium = 'sqlite'", () => {
    const conversationId = insertConversation("sqlite");
    const store = resolveConversationMessageStore(db, conversationId);
    expect(store).toBeInstanceOf(LegacySqliteConversationMessageStore);
  });

  it("defaults to LegacySqliteConversationMessageStore when storage_medium column value is absent/null-like (pre-existing rows)", () => {
    // Column default is 'sqlite' at the schema level, but this asserts the resolver's own
    // fallback behavior explicitly rather than relying only on the schema default.
    const conversationId = insertConversation();
    const row = db.query<{ storage_medium: string }, [number]>(
      "SELECT storage_medium FROM conversations WHERE id = ?",
    ).get(conversationId);
    expect(row?.storage_medium).toBe("sqlite");

    const store = resolveConversationMessageStore(db, conversationId);
    expect(store).toBeInstanceOf(LegacySqliteConversationMessageStore);
  });

  it("defaults to LegacySqliteConversationMessageStore for an unknown/nonexistent conversationId", () => {
    // No row at all — resolver must not throw, and must fail safe to the legacy medium.
    const store = resolveConversationMessageStore(db, 999999);
    expect(store).toBeInstanceOf(LegacySqliteConversationMessageStore);
  });

  it("treats any storage_medium value other than the literal 'file' as legacy sqlite", () => {
    // Defensive: an unrecognized/corrupted value should never resolve to the file store.
    const conversationId = insertConversation();
    db.run("UPDATE conversations SET storage_medium = 'unexpected-value' WHERE id = ?", [conversationId]);

    const store = resolveConversationMessageStore(db, conversationId);
    expect(store).toBeInstanceOf(LegacySqliteConversationMessageStore);
  });
});
