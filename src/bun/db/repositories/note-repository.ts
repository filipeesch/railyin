import type { Database } from "bun:sqlite";
import { getDb } from "../index.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskNote {
  id: number;
  conversationId: number;
  content: string;
  isSourceAi: boolean;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Row type ─────────────────────────────────────────────────────────────────

interface TaskNoteRow {
  id: number;
  conversation_id: number;
  content: string;
  is_source_ai: number;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Tag normalization ────────────────────────────────────────────────────────

const MAX_TAG_LENGTH = 15;
const MAX_TAGS_PER_NOTE = 4;

/**
 * Normalize tags: trim, lowercase, truncate, deduplicate, limit to 4, discard empty.
 * Returns null if the result is empty or input was empty/undefined.
 */
function normalizeTags(input: string[] | undefined | null): string[] | null {
  if (!input || input.length === 0) return null;

  const normalized = new Set<string>();
  for (const tag of input) {
    const cleaned = tag.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (cleaned.length > 0) {
      normalized.add(cleaned);
    }
  }

  const result = Array.from(normalized).slice(0, MAX_TAGS_PER_NOTE);
  return result.length > 0 ? result : null;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function parseTags(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mapRow(row: TaskNoteRow): TaskNote {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    content: row.content,
    isSourceAi: row.is_source_ai === 1,
    tags: parseTags(row.tags),
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
    input: { content: string; isSourceAi?: boolean; tags?: string[] },
  ): TaskNote {
    const normalizedTags = normalizeTags(input.tags);
    const tagsJson = normalizedTags != null ? JSON.stringify(normalizedTags) : null;

    const res = this.db.run(
      `INSERT INTO task_notes (conversation_id, content, is_source_ai, tags)
       VALUES (?, ?, ?, ?)`,
      [conversationId, input.content, input.isSourceAi ? 1 : 0, tagsJson],
    );
    const row = this.db
      .query<TaskNoteRow, [number]>("SELECT * FROM task_notes WHERE id = ?")
      .get(res.lastInsertRowid as number);
    return mapRow(row!);
  }

  updateNote(
    id: number,
    input: { content?: string; tags?: string[] },
  ): TaskNote | null {
    const existing = this.db
      .query<TaskNoteRow, [number]>("SELECT * FROM task_notes WHERE id = ?")
      .get(id);
    if (!existing) return null;

    const content = input.content !== undefined ? input.content : existing.content;

    // Empty array is no-op; undefined preserves existing
    let tagsJson: string | null = existing.tags;
    if (input.tags !== undefined && input.tags.length > 0) {
      const normalizedTags = normalizeTags(input.tags);
      tagsJson = normalizedTags != null ? JSON.stringify(normalizedTags) : null;
    }

    this.db.run(
      `UPDATE task_notes SET content = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`,
      [content, tagsJson, id],
    );

    const updated = this.db
      .query<TaskNoteRow, [number]>("SELECT * FROM task_notes WHERE id = ?")
      .get(id);
    return mapRow(updated!);
  }

  deleteNote(id: number): void {
    this.db.run("DELETE FROM task_notes WHERE id = ?", [id]);
  }

  listByConversation(
    conversationId: number,
    options?: { tagFilter?: string[] },
  ): TaskNote[] {
    const allNotes = this.db
      .query<TaskNoteRow, [number]>(
        "SELECT * FROM task_notes WHERE conversation_id = ? ORDER BY created_at ASC",
      )
      .all(conversationId)
      .map(mapRow);

    // No filter — return all
    if (!options?.tagFilter || options.tagFilter.length === 0) {
      return allNotes;
    }

    // Normalize filter tags for comparison
    const normalizedFilter = new Set(
      options.tagFilter.map((t) => t.trim().toLowerCase()),
    );

    // OR matching: note matches if any of its tags is in the filter set
    return allNotes.filter((note) => {
      if (note.tags == null) return false;
      return note.tags.some((tag) => normalizedFilter.has(tag));
    });
  }
}
