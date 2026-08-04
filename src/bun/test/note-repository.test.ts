import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../db/db.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";
import { initDb } from "./helpers.ts";

describe("NoteRepository", () => {
  let db: Db;
  let repo: NoteRepository;
  let conversationId: number;

  beforeEach(async () => {
    db = await initDb();
    repo = new NoteRepository(db);
    const conv = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id");
    conversationId = conv!.id;
  });

  it("NR-1: createNote returns a note with id and content", async () => {
    const note = await repo.createNote(conversationId, { content: "hello" });
    expect(note.id).toBeGreaterThan(0);
    expect(note.content).toBe("hello");
    expect(note.conversationId).toBe(conversationId);
  });

  it("NR-2: listByConversation returns all notes for a conversation, not others", async () => {
    const other = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id");
    const otherId = other!.id;

    await repo.createNote(conversationId, { content: "a" });
    await repo.createNote(conversationId, { content: "b" });
    await repo.createNote(otherId, { content: "other" });

    const notes = await repo.listByConversation(conversationId);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.content)).toEqual(["a", "b"]);
  });

  it("NR-3: updateNote changes content", async () => {
    const note = await repo.createNote(conversationId, { content: "original" });
    const updated = await repo.updateNote(note.id, { content: "updated" });
    expect(updated?.content).toBe("updated");
  });

  it("NR-4: deleteNote removes the row", async () => {
    const note = await repo.createNote(conversationId, { content: "to delete" });
    await repo.deleteNote(note.id);
    expect(await repo.listByConversation(conversationId)).toHaveLength(0);
  });

  it("NR-5: no cross-leak between two different conversationIds", async () => {
    const other = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id");
    const otherId = other!.id;

    await repo.createNote(conversationId, { content: "mine" });
    await repo.createNote(otherId, { content: "theirs" });

    expect((await repo.listByConversation(conversationId)).map((n) => n.content)).toEqual(["mine"]);
    expect((await repo.listByConversation(otherId)).map((n) => n.content)).toEqual(["theirs"]);
  });

  it("NR-6: createNote with isSourceAi true persists the flag", async () => {
    const note = await repo.createNote(conversationId, { content: "ai note", isSourceAi: true });
    expect(note.isSourceAi).toBe(true);
  });

  it("NR-7: updateNote on non-existent id returns null", async () => {
    const result = await repo.updateNote(99999, { content: "ghost" });
    expect(result).toBeNull();
  });

  it("NR-8: deleteNote on non-existent id is a no-op", async () => {
    await expect(repo.deleteNote(99999)).resolves.toBeUndefined();
  });

  // ─── Tag Normalization ──────────────────────────────────────────────────────

  it("NR-9: createNote normalizes tags (trim + lowercase)", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: [" Design ", "ARCHITECTURE"] });
    expect(note.tags).toEqual(["design", "architecture"]);
  });

  it("NR-10: createNote truncates tags > 15 chars", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: ["very-long-tag-name-here"] });
    expect(note.tags).toEqual(["very-long-tag-n"]);
  });

  it("NR-11: createNote deduplicates tags", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: ["design", "design", "architecture"] });
    expect(note.tags).toHaveLength(2);
    expect(note.tags).toContain("design");
    expect(note.tags).toContain("architecture");
  });

  it("NR-12: createNote limits to 4 tags max", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: ["a", "b", "c", "d", "e"] });
    expect(note.tags).toHaveLength(4);
    expect(note.tags).toContain("a");
    expect(note.tags).toContain("b");
    expect(note.tags).toContain("c");
    expect(note.tags).toContain("d");
    expect(note.tags).not.toContain("e");
  });

  it("NR-13: createNote discards empty strings after normalization", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: ["design", "  ", ""] });
    expect(note.tags).toEqual(["design"]);
  });

  it("NR-14: updateNote normalizes tags on update", async () => {
    const note = await repo.createNote(conversationId, { content: "test" });
    const updated = await repo.updateNote(note.id, { tags: [" New Tag "] });
    expect(updated?.tags).toEqual(["new tag"]);
  });

  it("NR-15: updateNote preserves tags when tags omitted", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: ["existing"] });
    const updated = await repo.updateNote(note.id, { content: "updated" });
    expect(updated?.tags).toEqual(["existing"]);
  });

  it("NR-16: empty tags array is no-op (preserves existing)", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: ["existing"] });
    const updated = await repo.updateNote(note.id, { tags: [] });
    expect(updated?.tags).toEqual(["existing"]);
  });

  // ─── Tag Storage ────────────────────────────────────────────────────────────

  it("NR-17: createNote with tags persists JSON array", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: ["design"] });
    expect(note.tags).toEqual(["design"]);
    const listed = await repo.listByConversation(conversationId);
    expect(listed[0].tags).toEqual(["design"]);
  });

  it("NR-18: createNote without tags persists null", async () => {
    const note = await repo.createNote(conversationId, { content: "test" });
    expect(note.tags).toBeNull();
  });

  it("NR-19: updateNote with tags replaces existing", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: ["old"] });
    const updated = await repo.updateNote(note.id, { tags: ["new"] });
    expect(updated?.tags).toEqual(["new"]);
  });

  it("NR-20: updateNote without tags preserves existing", async () => {
    const note = await repo.createNote(conversationId, { content: "test", tags: ["existing"] });
    const updated = await repo.updateNote(note.id, { content: "updated" });
    expect(updated?.tags).toEqual(["existing"]);
  });

  // ─── Tag Filtering ──────────────────────────────────────────────────────────

  it("NR-21: listByConversation with tagFilter returns matching notes (OR)", async () => {
    await repo.createNote(conversationId, { content: "a", tags: ["design"] });
    await repo.createNote(conversationId, { content: "b", tags: ["architecture"] });
    const notes = await repo.listByConversation(conversationId, { tagFilter: ["design"] });
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe("a");
  });

  it("NR-22: listByConversation without tagFilter returns all notes", async () => {
    await repo.createNote(conversationId, { content: "a", tags: ["design"] });
    await repo.createNote(conversationId, { content: "b", tags: ["architecture"] });
    const notes = await repo.listByConversation(conversationId);
    expect(notes).toHaveLength(2);
  });

  it("NR-23: tagFilter is case-insensitive", async () => {
    await repo.createNote(conversationId, { content: "a", tags: ["design"] });
    const notes = await repo.listByConversation(conversationId, { tagFilter: ["Design"] });
    expect(notes).toHaveLength(1);
  });

  it("NR-24: tagFilter with multiple tags uses OR matching", async () => {
    await repo.createNote(conversationId, { content: "a", tags: ["design"] });
    await repo.createNote(conversationId, { content: "b", tags: ["architecture"] });
    await repo.createNote(conversationId, { content: "c", tags: ["todo"] });
    const notes = await repo.listByConversation(conversationId, { tagFilter: ["design", "architecture"] });
    expect(notes).toHaveLength(2);
  });

  it("NR-25: tagFilter with no matches returns empty array", async () => {
    await repo.createNote(conversationId, { content: "a", tags: ["design"] });
    const notes = await repo.listByConversation(conversationId, { tagFilter: ["nonexistent"] });
    expect(notes).toHaveLength(0);
  });
});
