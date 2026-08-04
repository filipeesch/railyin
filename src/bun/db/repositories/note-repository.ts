import type { Db } from "../db.ts";
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
  private readonly db: Db;

  constructor(db?: Db) {
    this.db = db ?? getDb();
  }

  async createNote(
    conversationId: number,
    input: { content: string; isSourceAi?: boolean; tags?: string[] },
  ): Promise<TaskNote> {
    const normalizedTags = normalizeTags(input.tags);
    const tagsJson = normalizedTags != null ? JSON.stringify(normalizedTags) : null;

    const row = await this.db.get<TaskNoteRow>(
      `INSERT INTO task_notes (conversation_id, content, is_source_ai, tags)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [conversationId, input.content, input.isSourceAi ? 1 : 0, tagsJson],
    );
    return mapRow(row!);
  }

  async updateNote(
    id: number,
    input: { content?: string; tags?: string[] },
  ): Promise<TaskNote | null> {
    const existing = await this.db.get<TaskNoteRow>(
      "SELECT * FROM task_notes WHERE id = $1",
      [id],
    );
    if (!existing) return null;

    const content = input.content !== undefined ? input.content : existing.content;

    // Empty array is no-op; undefined preserves existing
    let tagsJson: string | null = existing.tags;
    if (input.tags !== undefined && input.tags.length > 0) {
      const normalizedTags = normalizeTags(input.tags);
      tagsJson = normalizedTags != null ? JSON.stringify(normalizedTags) : null;
    }

    await this.db.exec(
      `UPDATE task_notes SET content = $1, tags = $2, updated_at = ${this.db.dialect.now()} WHERE id = $3`,
      [content, tagsJson, id],
    );

    const updated = await this.db.get<TaskNoteRow>(
      "SELECT * FROM task_notes WHERE id = $1",
      [id],
    );
    return mapRow(updated!);
  }

  async deleteNote(id: number): Promise<void> {
    await this.db.exec("DELETE FROM task_notes WHERE id = $1", [id]);
  }

  async listByConversation(
    conversationId: number,
    options?: { tagFilter?: string[] },
  ): Promise<TaskNote[]> {
    const allNotes = (await this.db.rows<TaskNoteRow>(
      "SELECT * FROM task_notes WHERE conversation_id = $1 ORDER BY created_at ASC",
      [conversationId],
    )).map(mapRow);

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
