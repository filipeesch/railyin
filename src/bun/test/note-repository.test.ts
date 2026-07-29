import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "bun:sqlite";
import { NoteRepository } from "../db/repositories/note-repository.ts";
import { initDb } from "./helpers.ts";

describe("NoteRepository", () => {
  let db: Database;
  let repo: NoteRepository;
  let conversationId: number;

  beforeEach(() => {
    db = initDb();
    repo = new NoteRepository(db);
    db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
  });

  it("NR-1: createNote returns a note with id and content", () => {
    const note = repo.createNote(conversationId, { content: "hello" });
    expect(note.id).toBeGreaterThan(0);
    expect(note.content).toBe("hello");
    expect(note.conversationId).toBe(conversationId);
  });

  it("NR-2: listByConversation returns all notes for a conversation, not others", () => {
    db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    const otherId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

    repo.createNote(conversationId, { content: "a" });
    repo.createNote(conversationId, { content: "b" });
    repo.createNote(otherId, { content: "other" });

    const notes = repo.listByConversation(conversationId);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.content)).toEqual(["a", "b"]);
  });

  it("NR-3: updateNote changes content", () => {
    const note = repo.createNote(conversationId, { content: "original" });
    const updated = repo.updateNote(note.id, { content: "updated" });
    expect(updated?.content).toBe("updated");
  });

  it("NR-4: deleteNote removes the row", () => {
    const note = repo.createNote(conversationId, { content: "to delete" });
    repo.deleteNote(note.id);
    expect(repo.listByConversation(conversationId)).toHaveLength(0);
  });

  it("NR-5: no cross-leak between two different conversationIds", () => {
    db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    const otherId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

    repo.createNote(conversationId, { content: "mine" });
    repo.createNote(otherId, { content: "theirs" });

    expect(repo.listByConversation(conversationId).map((n) => n.content)).toEqual(["mine"]);
    expect(repo.listByConversation(otherId).map((n) => n.content)).toEqual(["theirs"]);
  });

  it("NR-6: createNote with isSourceAi true persists the flag", () => {
    const note = repo.createNote(conversationId, { content: "ai note", isSourceAi: true });
    expect(note.isSourceAi).toBe(true);
  });

  it("NR-7: updateNote on non-existent id returns null", () => {
    const result = repo.updateNote(99999, { content: "ghost" });
    expect(result).toBeNull();
  });

  it("NR-8: deleteNote on non-existent id is a no-op", () => {
    expect(() => repo.deleteNote(99999)).not.toThrow();
  });

  // ─── Tag Normalization ──────────────────────────────────────────────────────

  it("NR-9: createNote normalizes tags (trim + lowercase)", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: [" Design ", "ARCHITECTURE"] });
    expect(note.tags).toEqual(["design", "architecture"]);
  });

  it("NR-10: createNote truncates tags > 15 chars", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: ["very-long-tag-name-here"] });
    expect(note.tags).toEqual(["very-long-tag-n"]);
  });

  it("NR-11: createNote deduplicates tags", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: ["design", "design", "architecture"] });
    expect(note.tags).toHaveLength(2);
    expect(note.tags).toContain("design");
    expect(note.tags).toContain("architecture");
  });

  it("NR-12: createNote limits to 4 tags max", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: ["a", "b", "c", "d", "e"] });
    expect(note.tags).toHaveLength(4);
    expect(note.tags).toContain("a");
    expect(note.tags).toContain("b");
    expect(note.tags).toContain("c");
    expect(note.tags).toContain("d");
    expect(note.tags).not.toContain("e");
  });

  it("NR-13: createNote discards empty strings after normalization", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: ["design", "  ", ""] });
    expect(note.tags).toEqual(["design"]);
  });

  it("NR-14: updateNote normalizes tags on update", () => {
    const note = repo.createNote(conversationId, { content: "test" });
    const updated = repo.updateNote(note.id, { tags: [" New Tag "] });
    expect(updated?.tags).toEqual(["new tag"]);
  });

  it("NR-15: updateNote preserves tags when tags omitted", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: ["existing"] });
    const updated = repo.updateNote(note.id, { content: "updated" });
    expect(updated?.tags).toEqual(["existing"]);
  });

  it("NR-16: empty tags array is no-op (preserves existing)", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: ["existing"] });
    const updated = repo.updateNote(note.id, { tags: [] });
    expect(updated?.tags).toEqual(["existing"]);
  });

  // ─── Tag Storage ────────────────────────────────────────────────────────────

  it("NR-17: createNote with tags persists JSON array", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: ["design"] });
    expect(note.tags).toEqual(["design"]);
    const listed = repo.listByConversation(conversationId);
    expect(listed[0].tags).toEqual(["design"]);
  });

  it("NR-18: createNote without tags persists null", () => {
    const note = repo.createNote(conversationId, { content: "test" });
    expect(note.tags).toBeNull();
  });

  it("NR-19: updateNote with tags replaces existing", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: ["old"] });
    const updated = repo.updateNote(note.id, { tags: ["new"] });
    expect(updated?.tags).toEqual(["new"]);
  });

  it("NR-20: updateNote without tags preserves existing", () => {
    const note = repo.createNote(conversationId, { content: "test", tags: ["existing"] });
    const updated = repo.updateNote(note.id, { content: "updated" });
    expect(updated?.tags).toEqual(["existing"]);
  });

  // ─── Tag Filtering ──────────────────────────────────────────────────────────

  it("NR-21: listByConversation with tagFilter returns matching notes (OR)", () => {
    repo.createNote(conversationId, { content: "a", tags: ["design"] });
    repo.createNote(conversationId, { content: "b", tags: ["architecture"] });
    const notes = repo.listByConversation(conversationId, { tagFilter: ["design"] });
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe("a");
  });

  it("NR-22: listByConversation without tagFilter returns all notes", () => {
    repo.createNote(conversationId, { content: "a", tags: ["design"] });
    repo.createNote(conversationId, { content: "b", tags: ["architecture"] });
    const notes = repo.listByConversation(conversationId);
    expect(notes).toHaveLength(2);
  });

  it("NR-23: tagFilter is case-insensitive", () => {
    repo.createNote(conversationId, { content: "a", tags: ["design"] });
    const notes = repo.listByConversation(conversationId, { tagFilter: ["Design"] });
    expect(notes).toHaveLength(1);
  });

  it("NR-24: tagFilter with multiple tags uses OR matching", () => {
    repo.createNote(conversationId, { content: "a", tags: ["design"] });
    repo.createNote(conversationId, { content: "b", tags: ["architecture"] });
    repo.createNote(conversationId, { content: "c", tags: ["todo"] });
    const notes = repo.listByConversation(conversationId, { tagFilter: ["design", "architecture"] });
    expect(notes).toHaveLength(2);
  });

  it("NR-25: tagFilter with no matches returns empty array", () => {
    repo.createNote(conversationId, { content: "a", tags: ["design"] });
    const notes = repo.listByConversation(conversationId, { tagFilter: ["nonexistent"] });
    expect(notes).toHaveLength(0);
  });
});
