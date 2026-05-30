import type { Database } from "bun:sqlite";
import { getDb } from "../index.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskNote {
  id: number;
  conversationId: number;
  title: string | null;
  content: string;
  isSourceAi: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Row type ─────────────────────────────────────────────────────────────────

interface TaskNoteRow {
  id: number;
  conversation_id: number;
  title: string | null;
  content: string;
  is_source_ai: number;
  created_at: string;
  updated_at: string;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function mapRow(row: TaskNoteRow): TaskNote {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    title: row.title,
    content: row.content,
    isSourceAi: row.is_source_ai === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── NoteRepository ───────────────────────────────────────────────────────────

export class NoteRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  createNote(
    conversationId: number,
    input: { title?: string | null; content: string; isSourceAi?: boolean },
  ): TaskNote {
    const res = this.db.run(
      `INSERT INTO task_notes (conversation_id, title, content, is_source_ai)
       VALUES (?, ?, ?, ?)`,
      [
        conversationId,
        input.title ?? null,
        input.content,
        input.isSourceAi ? 1 : 0,
      ],
    );
    const row = this.db
      .query<TaskNoteRow, [number]>("SELECT * FROM task_notes WHERE id = ?")
      .get(res.lastInsertRowid as number);
    return mapRow(row!);
  }

  updateNote(id: number, input: { title?: string | null; content?: string }): TaskNote | null {
    const existing = this.db
      .query<TaskNoteRow, [number]>("SELECT * FROM task_notes WHERE id = ?")
      .get(id);
    if (!existing) return null;

    const title = "title" in input ? input.title : existing.title;
    const content = input.content !== undefined ? input.content : existing.content;

    this.db.run(
      `UPDATE task_notes
       SET title = ?, content = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [title ?? null, content, id],
    );

    const updated = this.db
      .query<TaskNoteRow, [number]>("SELECT * FROM task_notes WHERE id = ?")
      .get(id);
    return mapRow(updated!);
  }

  deleteNote(id: number): void {
    this.db.run("DELETE FROM task_notes WHERE id = ?", [id]);
  }

  listByConversation(conversationId: number): TaskNote[] {
    return this.db
      .query<TaskNoteRow, [number]>(
        "SELECT * FROM task_notes WHERE conversation_id = ? ORDER BY created_at ASC",
      )
      .all(conversationId)
      .map(mapRow);
  }
}
