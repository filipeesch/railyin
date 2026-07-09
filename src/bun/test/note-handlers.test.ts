import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { noteHandlers } from "../handlers/notes.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let configCleanup: () => void;
let conversationId: number;

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();
  const seed = seedProjectAndTask(db, "/test-git");
  conversationId = seed.conversationId;
});

afterEach(() => {
  configCleanup();
});

// ─── notes.list ────────────────────────────────────────────────────────────────

describe("notes.list", () => {
  it("NL-1: empty result when no notes exist for conversation", () => {
    const handlers = noteHandlers(db);

    const result = handlers["notes.list"]({ conversationId });
    expect(result).toEqual([]);
  });

  it("NL-2: returns all notes for a conversation", () => {
    const handlers = noteHandlers(db);

    db.run(
      "INSERT INTO task_notes (conversation_id, content) VALUES (?, ?)",
      [conversationId, "Note 1"],
    );
    db.run(
      "INSERT INTO task_notes (conversation_id, content) VALUES (?, ?)",
      [conversationId, "Note 2"],
    );

    const result = handlers["notes.list"]({ conversationId });
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Note 1");
    expect(result[1].content).toBe("Note 2");
  });

  it("NL-3: cross-conversation isolation", () => {
    const handlers = noteHandlers(db);

    db.run(
      "INSERT INTO task_notes (conversation_id, content) VALUES (?, ?)",
      [conversationId, "This conversation"],
    );
    // Create another conversation with its own note
    const otherSeed = seedProjectAndTask(db, "/test-git");
    db.run(
      "INSERT INTO task_notes (conversation_id, content) VALUES (?, ?)",
      [otherSeed.conversationId, "Other conversation"],
    );

    const result = handlers["notes.list"]({ conversationId });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("This conversation");
  });
});

// ─── notes.create ──────────────────────────────────────────────────────────────

describe("notes.create", () => {
  it("NC-1: returns full TaskNote object", () => {
    const handlers = noteHandlers(db);

    const result = handlers["notes.create"]({
      conversationId,
      content: "New note",
    });

    expect(result).toHaveProperty("id");
    expect(result.conversationId).toBe(conversationId);
    expect(result.content).toBe("New note");
    expect(result.isSourceAi).toBe(false); // defaults to false
    expect(result).toHaveProperty("createdAt");
    expect(result).toHaveProperty("updatedAt");
  });

  it("NC-2: isSourceAi is false by default", () => {
    const handlers = noteHandlers(db);

    const result = handlers["notes.create"]({
      conversationId,
      content: "Note content",
    });

    expect(result.isSourceAi).toBe(false);
  });
});

// ─── notes.update ──────────────────────────────────────────────────────────────

describe("notes.update", () => {
  it("NU-1: patches content", () => {
    const handlers = noteHandlers(db);
    const created = handlers["notes.create"]({ conversationId, content: "Original" });

    handlers["notes.update"]({ id: created.id, content: "Updated" });

    const updated = handlers["notes.list"]({ conversationId }).find((n) => n.id === created.id);
    expect(updated!.content).toBe("Updated");
  });

  it("NU-2: update on non-existent id throws", () => {
    const handlers = noteHandlers(db);

    expect(() => handlers["notes.update"]({ id: 99999, content: "x" })).toThrow(
      "Note #99999 not found",
    );
  });
});

// ─── notes.delete ──────────────────────────────────────────────────────────────

describe("notes.delete", () => {
  it("ND-1: note absent after delete", () => {
    const handlers = noteHandlers(db);
    const created = handlers["notes.create"]({ conversationId, content: "To delete" });

    handlers["notes.delete"]({ id: created.id });

    const result = handlers["notes.list"]({ conversationId });
    expect(result).toHaveLength(0);
  });

  it("ND-2: delete on unknown id is a no-op (repo ignores missing)", () => {
    const handlers = noteHandlers(db);

    // deleteNote doesn't throw for missing ids — it's idempotent
    handlers["notes.delete"]({ id: 99999 });
    // Should not throw
  });
});
