import type { Db } from "../db.ts";
import { getDb } from "../index.ts";
import { ConversationInjectionStateRepository } from "./conversation-injection-state-repository.ts";

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

// ─── DecisionRepository ───────────────────────────────────────────────────────

export class DecisionRepository {
  private readonly db: Db;
  private readonly injectionStateRepo: ConversationInjectionStateRepository;

  constructor(db?: Db) {
    this.db = db ?? getDb();
    this.injectionStateRepo = new ConversationInjectionStateRepository(this.db);
  }

  async createRecord(
    conversationId: number,
    input: {
      batchId?: number | null;
      question: string;
      answer: string;
      weight?: DecisionWeight;
      notes?: string | null;
      isSourceAi?: boolean;
    },
  ): Promise<DecisionRecord> {
    const row = await this.db.get<DecisionRecordRow>(
      `INSERT INTO decision_records
        (conversation_id, batch_id, question, answer, weight, notes, is_source_ai)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
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
    return mapRecordRow(row!);
  }

  async updateRecord(
    id: number,
    newAnswer: string,
    reason: string,
    newNotes?: string | null,
  ): Promise<DecisionRecord> {
    const existing = await this.db.get<DecisionRecordRow>(
      "SELECT * FROM decision_records WHERE id = $1",
      [id],
    );
    if (!existing) throw new Error(`Decision record ${id} not found`);

    await this.db.exec(
      `INSERT INTO decision_revisions (decision_id, previous_answer, previous_notes, reason)
       VALUES ($1, $2, $3, $4)`,
      [id, existing.answer, existing.notes, reason],
    );

    const notesValue = newNotes !== undefined ? newNotes : existing.notes;
    await this.db.exec(
      `UPDATE decision_records
       SET answer = $1, notes = $2, revision_count = revision_count + 1, updated_at = ${this.db.dialect.now()}
       WHERE id = $3`,
      [newAnswer, notesValue, id],
    );

    const updated = await this.db.get<DecisionRecordRow>(
      "SELECT * FROM decision_records WHERE id = $1",
      [id],
    );
    return mapRecordRow(updated!);
  }

  async deleteRecord(id: number): Promise<void> {
    await this.db.exec(
      `UPDATE decision_records SET is_deleted = 1, updated_at = ${this.db.dialect.now()} WHERE id = $1`,
      [id],
    );
  }

  async listByConversation(conversationId: number): Promise<DecisionRecord[]> {
    const rows = await this.db.rows<DecisionRecordRow>(
      `SELECT * FROM decision_records
       WHERE conversation_id = $1 AND is_deleted = 0
       ORDER BY CASE weight WHEN 'critical' THEN 1 WHEN 'medium' THEN 2 WHEN 'easy' THEN 3 END ASC`,
      [conversationId],
    );
    return rows.map(mapRecordRow);
  }

  async getRevisions(decisionId: number): Promise<DecisionRevision[]> {
    const rows = await this.db.rows<DecisionRevisionRow>(
      "SELECT * FROM decision_revisions WHERE decision_id = $1 ORDER BY revised_at ASC",
      [decisionId],
    );
    return rows.map(mapRevisionRow);
  }

  async buildContextBlock(conversationId: number): Promise<string> {
    const records = await this.listByConversation(conversationId);
    if (records.length === 0) return "";

    const lines: string[] = [];

    let prevWeight: DecisionWeight | null = null;
    for (const record of records) {
      if (prevWeight !== null && prevWeight !== record.weight) {
        lines.push("");
      }
      prevWeight = record.weight;

      const weightLabel = `[${record.weight.toUpperCase()}]`;
      const aiSuffix = record.isSourceAi ? "  [AI-recorded]" : "";
      let line = `${weightLabel} ${record.question}${aiSuffix}\n→ ${record.answer}`;

      if (record.notes !== null) {
        line += `\n  Notes: ${record.notes}`;
      }

      if (record.revisionCount > 0) {
        const revisions = await this.getRevisions(record.id);
        const last = revisions[revisions.length - 1];
        line += `\n  (revised ${record.revisionCount}x · last reason: "${last.reason}")`;
      }

      lines.push(line);
    }

    return `<decisions>\n${lines.join("\n")}\n</decisions>`;
  }

  async markDecisionsInjected(conversationId: number, compactionSummaryId: number): Promise<void> {
    await this.injectionStateRepo.markInjected(conversationId, "decisions", compactionSummaryId);
  }

  async getLastInjectedCompactionId(conversationId: number): Promise<number | null> {
    return this.injectionStateRepo.getLastInjected(conversationId, "decisions");
  }
}
