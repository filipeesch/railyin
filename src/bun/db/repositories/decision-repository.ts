import type { Database } from "bun:sqlite";
import { getDb } from "../index.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DecisionWeight = "critical" | "medium" | "easy";

export interface DecisionRecord {
  id: number;
  conversationId: number;
  batchId: number | null;
  question: string;
  answer: string;
  weight: DecisionWeight;
  notes: string | null;
  revisionCount: number;
  isSourceAi: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRevision {
  id: number;
  decisionId: number;
  previousAnswer: string;
  previousNotes: string | null;
  reason: string;
  revisedAt: string;
}

export interface DecisionBatch {
  id: number;
  conversationId: number;
  label: string | null;
  createdAt: string;
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface DecisionRecordRow {
  id: number;
  conversation_id: number;
  batch_id: number | null;
  question: string;
  answer: string;
  weight: string;
  notes: string | null;
  revision_count: number;
  is_source_ai: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}

interface DecisionRevisionRow {
  id: number;
  decision_id: number;
  previous_answer: string;
  previous_notes: string | null;
  reason: string;
  revised_at: string;
}

interface DecisionBatchRow {
  id: number;
  conversation_id: number;
  label: string | null;
  created_at: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapRecordRow(row: DecisionRecordRow): DecisionRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    batchId: row.batch_id,
    question: row.question,
    answer: row.answer,
    weight: row.weight as DecisionWeight,
    notes: row.notes,
    revisionCount: row.revision_count,
    isSourceAi: row.is_source_ai === 1,
    isDeleted: row.is_deleted === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRevisionRow(row: DecisionRevisionRow): DecisionRevision {
  return {
    id: row.id,
    decisionId: row.decision_id,
    previousAnswer: row.previous_answer,
    previousNotes: row.previous_notes,
    reason: row.reason,
    revisedAt: row.revised_at,
  };
}

function mapBatchRow(row: DecisionBatchRow): DecisionBatch {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    label: row.label,
    createdAt: row.created_at,
  };
}

// ─── DecisionRepository ───────────────────────────────────────────────────────

export class DecisionRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  createBatch(conversationId: number, label?: string): DecisionBatch {
    const res = this.db.run(
      "INSERT INTO decision_batches (conversation_id, label) VALUES (?, ?)",
      [conversationId, label ?? null],
    );
    const row = this.db
      .query<DecisionBatchRow, [number]>(
        "SELECT * FROM decision_batches WHERE id = ?",
      )
      .get(res.lastInsertRowid as number);
    return mapBatchRow(row!);
  }

  createRecord(
    conversationId: number,
    input: {
      batchId?: number | null;
      question: string;
      answer: string;
      weight?: DecisionWeight;
      notes?: string | null;
      isSourceAi?: boolean;
    },
  ): DecisionRecord {
    const res = this.db.run(
      `INSERT INTO decision_records
        (conversation_id, batch_id, question, answer, weight, notes, is_source_ai)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        conversationId,
        input.batchId ?? null,
        input.question,
        input.answer,
        input.weight ?? "medium",
        input.notes ?? null,
        input.isSourceAi ? 1 : 0,
      ],
    );
    const row = this.db
      .query<DecisionRecordRow, [number]>(
        "SELECT * FROM decision_records WHERE id = ?",
      )
      .get(res.lastInsertRowid as number);
    return mapRecordRow(row!);
  }

  updateRecord(
    id: number,
    newAnswer: string,
    reason: string,
    newNotes?: string | null,
  ): DecisionRecord {
    const existing = this.db
      .query<DecisionRecordRow, [number]>(
        "SELECT * FROM decision_records WHERE id = ?",
      )
      .get(id);
    if (!existing) throw new Error(`Decision record ${id} not found`);

    this.db.run(
      `INSERT INTO decision_revisions (decision_id, previous_answer, previous_notes, reason)
       VALUES (?, ?, ?, ?)`,
      [id, existing.answer, existing.notes, reason],
    );

    const notesValue = newNotes !== undefined ? newNotes : existing.notes;
    this.db.run(
      `UPDATE decision_records
       SET answer = ?, notes = ?, revision_count = revision_count + 1, updated_at = datetime('now')
       WHERE id = ?`,
      [newAnswer, notesValue, id],
    );

    const updated = this.db
      .query<DecisionRecordRow, [number]>(
        "SELECT * FROM decision_records WHERE id = ?",
      )
      .get(id);
    return mapRecordRow(updated!);
  }

  deleteRecord(id: number): void {
    this.db.run(
      "UPDATE decision_records SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?",
      [id],
    );
  }

  listByConversation(conversationId: number): DecisionRecord[] {
    return this.db
      .query<DecisionRecordRow, [number]>(
        `SELECT * FROM decision_records
         WHERE conversation_id = ? AND is_deleted = 0
         ORDER BY CASE weight WHEN 'critical' THEN 1 WHEN 'medium' THEN 2 WHEN 'easy' THEN 3 END ASC`,
      )
      .all(conversationId)
      .map(mapRecordRow);
  }

  getRevisions(decisionId: number): DecisionRevision[] {
    return this.db
      .query<DecisionRevisionRow, [number]>(
        "SELECT * FROM decision_revisions WHERE decision_id = ? ORDER BY revised_at ASC",
      )
      .all(decisionId)
      .map(mapRevisionRow);
  }

  buildSystemBlock(conversationId: number): string {
    const records = this.listByConversation(conversationId);
    if (records.length === 0) return "";

    const lines: string[] = [
      "## Decision Records",
      "These decisions were made for this task. Honor them unless explicitly asked to reconsider.",
      "Use list_decisions() to review all details. Use update_decision(id, answer, reason) to revise.",
      "",
    ];

    let prevWeight: DecisionWeight | null = null;
    for (const record of records) {
      if (prevWeight !== null && prevWeight !== record.weight) {
        lines.push("");
      }
      prevWeight = record.weight;

      const weightLabel = `[${record.weight.toUpperCase()}]`;
      const aiSuffix = record.isSourceAi ? "  [AI-recorded]" : "";
      lines.push(`${weightLabel} ${record.question}${aiSuffix}`);
      lines.push(`→ ${record.answer}`);

      if (record.notes !== null) {
        lines.push(`  Notes: ${record.notes}`);
      }

      if (record.revisionCount > 0) {
        const revisions = this.getRevisions(record.id);
        const last = revisions[revisions.length - 1];
        lines.push(`  (revised ${record.revisionCount}x · last reason: "${last.reason}")`);
      }
    }

    return lines.join("\n");
  }
}
