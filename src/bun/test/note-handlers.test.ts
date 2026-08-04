import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { noteHandlers } from "../handlers/notes.ts";
import type { Db } from "../db/db.ts";

let db: Db;
let configCleanup: () => void;
let conversationId: number;

beforeEach(async () => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = await initDb();
  const seed = await seedProjectAndTask(db, "/test-git");
  conversationId = seed.conversationId;
});

afterEach(() => {
  configCleanup();
});

// ─── notes.list ────────────────────────────────────────────────────────────────

describe("notes.list", () => {
  it("NL-1: empty result when no notes exist for conversation", async () => {
    const handlers = noteHandlers(db);

    const result = await handlers["notes.list"]({ conversationId });
    expect(result).toEqual([]);
  });

  it("NL-2: returns all notes for a conversation", async () => {
    const handlers = noteHandlers(db);

    await db.exec(
      "INSERT INTO task_notes (conversation_id, content) VALUES ($1, $2)",
      [conversationId, "Note 1"],
    );
    await db.exec(
      "INSERT INTO task_notes (conversation_id, content) VALUES ($1, $2)",
      [conversationId, "Note 2"],
    );

    const result = await handlers["notes.list"]({ conversationId });
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Note 1");
    expect(result[1].content).toBe("Note 2");
  });

  it("NL-3: cross-conversation isolation", async () => {
    const handlers = noteHandlers(db);

    await db.exec(
      "INSERT INTO task_notes (conversation_id, content) VALUES ($1, $2)",
      [conversationId, "This conversation"],
    );
    // Create another conversation with its own note
    const otherSeed = await seedProjectAndTask(db, "/test-git");
    await db.exec(
      "INSERT INTO task_notes (conversation_id, content) VALUES ($1, $2)",
      [otherSeed.conversationId, "Other conversation"],
    );

    const result = await handlers["notes.list"]({ conversationId });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("This conversation");
  });
});

// ─── notes.create ──────────────────────────────────────────────────────────────

describe("notes.create", () => {
  it("NC-1: returns full TaskNote object", async () => {
    const handlers = noteHandlers(db);

    const result = await handlers["notes.create"]({
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

  it("NC-2: isSourceAi is false by default", async () => {
    const handlers = noteHandlers(db);

    const result = await handlers["notes.create"]({
      conversationId,
      content: "Note content",
    });

    expect(result.isSourceAi).toBe(false);
  });
});

// ─── notes.update ──────────────────────────────────────────────────────────────

describe("notes.update", () => {
  it("NU-1: patches content", async () => {
    const handlers = noteHandlers(db);
    const created = await handlers["notes.create"]({ conversationId, content: "Original" });

    await handlers["notes.update"]({ id: created.id, content: "Updated" });

    const updated = (await handlers["notes.list"]({ conversationId })).find((n) => n.id === created.id);
    expect(updated!.content).toBe("Updated");
  });

  it("NU-2: update on non-existent id throws", async () => {
    const handlers = noteHandlers(db);

    await expect(handlers["notes.update"]({ id: 99999, content: "x" })).rejects.toThrow(
      "Note #99999 not found",
    );
  });
});

// ─── notes.delete ──────────────────────────────────────────────────────────────

describe("notes.delete", () => {
  it("ND-1: note absent after delete", async () => {
    const handlers = noteHandlers(db);
    const created = await handlers["notes.create"]({ conversationId, content: "To delete" });

    await handlers["notes.delete"]({ id: created.id });

    const result = await handlers["notes.list"]({ conversationId });
    expect(result).toHaveLength(0);
  });

  it("ND-2: delete on unknown id is a no-op (repo ignores missing)", async () => {
    const handlers = noteHandlers(db);

    // deleteNote doesn't throw for missing ids — it's idempotent
    await handlers["notes.delete"]({ id: 99999 });
    // Should not throw
  });
});

// ─── notes.list with tags ─────────────────────────────────────────────────────

describe("notes.list with tags", () => {
  it("NL-4: notes.list with tags filter passes to repository", async () => {
    const handlers = noteHandlers(db);

    await handlers["notes.create"]({ conversationId, content: "Note 1", tags: ["design"] });
    await handlers["notes.create"]({ conversationId, content: "Note 2", tags: ["architecture"] });

    const result = await handlers["notes.list"]({ conversationId, tags: ["design"] });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Note 1");
  });

  it("NL-5: notes.list without tags returns all notes", async () => {
    const handlers = noteHandlers(db);

    await handlers["notes.create"]({ conversationId, content: "Note 1", tags: ["design"] });
    await handlers["notes.create"]({ conversationId, content: "Note 2", tags: ["architecture"] });

    const result = await handlers["notes.list"]({ conversationId });
    expect(result).toHaveLength(2);
  });
});

// ─── notes.create with tags ───────────────────────────────────────────────────

describe("notes.create with tags", () => {
  it("NC-3: notes.create with tags persists normalized tags", async () => {
    const handlers = noteHandlers(db);

    const result = await handlers["notes.create"]({
      conversationId,
      content: "New note",
      tags: [" Design ", "TODO"],
    });

    expect(result.tags).toEqual(["design", "todo"]);
  });

  it("NC-4: notes.create without tags has null tags", async () => {
    const handlers = noteHandlers(db);

    const result = await handlers["notes.create"]({
      conversationId,
      content: "New note",
    });

    expect(result.tags).toBeNull();
  });
});

// ─── notes.update with tags ───────────────────────────────────────────────────

describe("notes.update with tags", () => {
  it("NU-3: notes.update with tags replaces existing", async () => {
    const handlers = noteHandlers(db);
    const created = await handlers["notes.create"]({ conversationId, content: "Original", tags: ["old"] });

    await handlers["notes.update"]({ id: created.id, tags: ["new"] });

    const updated = (await handlers["notes.list"]({ conversationId })).find((n) => n.id === created.id);
    expect(updated!.tags).toEqual(["new"]);
  });

  it("NU-4: notes.update without tags preserves existing", async () => {
    const handlers = noteHandlers(db);
    const created = await handlers["notes.create"]({ conversationId, content: "Original", tags: ["existing"] });

    await handlers["notes.update"]({ id: created.id, content: "Updated" });

    const updated = (await handlers["notes.list"]({ conversationId })).find((n) => n.id === created.id);
    expect(updated!.tags).toEqual(["existing"]);
  });
});
