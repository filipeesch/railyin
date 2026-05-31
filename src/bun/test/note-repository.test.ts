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
});
