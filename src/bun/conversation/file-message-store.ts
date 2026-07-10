import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { getDataDir } from "../utils/platform.ts";
import type { MessageType } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import type { ConversationMessageStore, NewConversationMessageInput } from "./message-store.ts";
import { KeyedWriteQueue } from "../utils/write-queue.ts";

/** Shape of a single JSONL line (excludes `id` — derived from 1-based line position). */
interface StoredMessageLine {
  taskId: number | null;
  type: MessageType;
  role: string | null;
  content: string;
  metadata: string | null;
  createdAt: string;
}

/** Marker written in place of a line that failed to serialize/write cleanly (crash mid-write).
 *  Preserves line-number-as-id stability: the line still "exists" but resolves to no message. */
interface TombstoneLine {
  tombstone: true;
}

type JsonlLine = StoredMessageLine | TombstoneLine;

function isTombstone(line: JsonlLine): line is TombstoneLine {
  return (line as TombstoneLine).tombstone === true;
}

interface SidecarMeta {
  lineCount: number;
  byteLength: number;
  lastCompactionSummaryId: number | null;
  lastCompactionSummaryByteOffset: number | null;
}

function emptySidecar(): SidecarMeta {
  return { lineCount: 0, byteLength: 0, lastCompactionSummaryId: null, lastCompactionSummaryByteOffset: null };
}

/** Shared per-process write queue: guarantees appends to the same conversation's file never
 *  interleave, regardless of how many `FileConversationMessageStore` instances are created for
 *  that conversationId (e.g. across concurrent RPC calls resolving the store independently). */
const writeQueue = new KeyedWriteQueue();

/**
 * File-backed `ConversationMessageStore`: messages are appended as JSON Lines to
 * `~/.railyn/conversations/<conversationId>.jsonl`, with a `.meta.json` sidecar accelerating
 * hot queries (tail reads, compaction-anchor lookups) without scanning the whole file.
 *
 * Message `id` = 1-based line number, derived from file position — never stored redundantly
 * in the line payload itself.
 */
export class FileConversationMessageStore implements ConversationMessageStore {
  private readonly jsonlPath: string;
  private readonly metaPath: string;

  constructor(private readonly conversationId: number, baseDir: string = join(getDataDir(), "conversations")) {
    this.jsonlPath = join(baseDir, `${conversationId}.jsonl`);
    this.metaPath = join(baseDir, `${conversationId}.meta.json`);
  }

  async append(input: NewConversationMessageInput): Promise<ConversationMessageRow> {
    const [row] = await this.appendBatch([input]);
    return row;
  }

  async appendBatch(inputs: NewConversationMessageInput[]): Promise<ConversationMessageRow[]> {
    if (inputs.length === 0) return [];
    return writeQueue.enqueue(String(this.conversationId), async () => {
      await fs.mkdir(dirname(this.jsonlPath), { recursive: true });
      const meta = await this.readOrRecomputeSidecar();

      const rows: ConversationMessageRow[] = [];
      let appendedText = "";
      let runningByteLength = meta.byteLength;
      let runningLineCount = meta.lineCount;
      let lastCompactionSummaryId = meta.lastCompactionSummaryId;
      let lastCompactionSummaryByteOffset = meta.lastCompactionSummaryByteOffset;

      for (const input of inputs) {
        const createdAt = new Date().toISOString();
        const line: StoredMessageLine = {
          taskId: input.taskId,
          type: input.type,
          role: input.role,
          content: input.content,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          createdAt,
        };
        const serialized = `${JSON.stringify(line)}\n`;

        if (input.type === "compaction_summary") {
          lastCompactionSummaryId = runningLineCount + 1;
          lastCompactionSummaryByteOffset = runningByteLength;
        }

        appendedText += serialized;
        runningByteLength += Buffer.byteLength(serialized, "utf-8");
        runningLineCount += 1;

        rows.push({
          id: runningLineCount,
          task_id: input.taskId,
          conversation_id: this.conversationId,
          type: input.type,
          role: input.role,
          content: input.content,
          metadata: line.metadata,
          created_at: createdAt,
        });
      }

      await fs.appendFile(this.jsonlPath, appendedText, "utf-8");

      const newMeta: SidecarMeta = {
        lineCount: runningLineCount,
        byteLength: runningByteLength,
        lastCompactionSummaryId,
        lastCompactionSummaryByteOffset,
      };
      await this.writeSidecarAtomic(newMeta);

      return rows;
    });
  }

  async getById(id: number): Promise<ConversationMessageRow | null> {
    if (id < 1) return null;
    const rows = await this.readLinesInRange(id, id);
    return rows[0] ?? null;
  }

  async getLastByType(type: MessageType): Promise<ConversationMessageRow | null> {
    if (type === "compaction_summary") {
      const meta = await this.readOrRecomputeSidecar();
      if (meta.lastCompactionSummaryId != null) {
        return this.getById(meta.lastCompactionSummaryId);
      }
      return null;
    }
    const all = await this.readAllRows();
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].type === type) return all[i];
    }
    return null;
  }

  async getRange(fromId: number, opts?: { limit?: number; excludeFromId?: number }): Promise<ConversationMessageRow[]> {
    const meta = await this.readOrRecomputeSidecar();
    const limit = opts?.limit ?? 200;
    const startId = Math.max(fromId, 1);
    const endId = opts?.excludeFromId != null ? Math.min(opts.excludeFromId - 1, meta.lineCount) : meta.lineCount;
    if (startId > endId) return [];
    const rows = await this.readLinesInRange(startId, endId);
    return rows.slice(0, limit);
  }

  async getPage(opts: { beforeMessageId?: number; limit: number }): Promise<{ rows: ConversationMessageRow[]; hasMore: boolean }> {
    const meta = await this.readOrRecomputeSidecar();
    const limit = opts.limit;
    const upperBoundExclusive = opts.beforeMessageId != null ? opts.beforeMessageId : meta.lineCount + 1;
    const upperId = Math.min(upperBoundExclusive - 1, meta.lineCount);
    if (upperId < 1) return { rows: [], hasMore: false };
    const lowerId = Math.max(upperId - limit + 1, 1);
    const rows = await this.readLinesInRange(lowerId, upperId);
    const hasMore = lowerId > 1;
    return { rows, hasMore };
  }

  async getAll(filter?: { types?: MessageType[] }): Promise<ConversationMessageRow[]> {
    const all = await this.readAllRows();
    if (filter?.types && filter.types.length > 0) {
      const typeSet = new Set(filter.types);
      return all.filter((row) => typeSet.has(row.type as MessageType));
    }
    return all;
  }

  async deleteAll(): Promise<void> {
    await writeQueue.enqueue(String(this.conversationId), async () => {
      await Promise.all([
        fs.rm(this.jsonlPath, { force: true }),
        fs.rm(this.metaPath, { force: true }),
      ]);
    });
  }

  // ─── Internal: sidecar ────────────────────────────────────────────────────

  private async readOrRecomputeSidecar(): Promise<SidecarMeta> {
    let actualByteLength: number;
    try {
      const stat = await fs.stat(this.jsonlPath);
      actualByteLength = stat.size;
    } catch {
      // JSONL file doesn't exist yet — fresh conversation.
      return emptySidecar();
    }

    let sidecar: SidecarMeta | null = null;
    try {
      const raw = await fs.readFile(this.metaPath, "utf-8");
      sidecar = JSON.parse(raw) as SidecarMeta;
    } catch {
      sidecar = null;
    }

    if (sidecar != null && sidecar.byteLength === actualByteLength) {
      return sidecar;
    }

    // Sidecar missing or drifted from the JSONL file (e.g. crash between the two writes) —
    // recompute by scanning the file once, then persist the corrected sidecar.
    const recomputed = await this.recomputeSidecarFromJsonl();
    await this.writeSidecarAtomic(recomputed);
    return recomputed;
  }

  private async recomputeSidecarFromJsonl(): Promise<SidecarMeta> {
    let raw: string;
    try {
      raw = await fs.readFile(this.jsonlPath, "utf-8");
    } catch {
      return emptySidecar();
    }
    const lines = raw.length > 0 ? raw.split("\n").filter((l) => l.length > 0) : [];
    let byteOffset = 0;
    let lastCompactionSummaryId: number | null = null;
    let lastCompactionSummaryByteOffset: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const lineWithNewline = `${lines[i]}\n`;
      try {
        const parsed = JSON.parse(lines[i]) as JsonlLine;
        if (!isTombstone(parsed) && parsed.type === "compaction_summary") {
          lastCompactionSummaryId = i + 1;
          lastCompactionSummaryByteOffset = byteOffset;
        }
      } catch {
        // corrupted line — ignore for anchor purposes, still counts toward lineCount/byteLength
      }
      byteOffset += Buffer.byteLength(lineWithNewline, "utf-8");
    }
    return {
      lineCount: lines.length,
      byteLength: byteOffset,
      lastCompactionSummaryId,
      lastCompactionSummaryByteOffset,
    };
  }

  private async writeSidecarAtomic(meta: SidecarMeta): Promise<void> {
    const tmpPath = `${this.metaPath}.tmp`;
    await fs.mkdir(dirname(this.metaPath), { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(meta), "utf-8");
    await fs.rename(tmpPath, this.metaPath);
  }

  // ─── Internal: reads ──────────────────────────────────────────────────────

  private async readAllRows(): Promise<ConversationMessageRow[]> {
    const meta = await this.readOrRecomputeSidecar();
    if (meta.lineCount === 0) return [];
    return this.readLinesInRange(1, meta.lineCount);
  }

  /** Reads lines with 1-based id in [fromId, toId] inclusive, skipping tombstones. */
  private async readLinesInRange(fromId: number, toId: number): Promise<ConversationMessageRow[]> {
    if (toId < fromId) return [];
    let raw: string;
    try {
      raw = await fs.readFile(this.jsonlPath, "utf-8");
    } catch {
      return [];
    }
    const lines = raw.length > 0 ? raw.split("\n").filter((l) => l.length > 0) : [];
    const rows: ConversationMessageRow[] = [];
    const lastIndex = Math.min(toId, lines.length);
    for (let idx = fromId; idx <= lastIndex; idx++) {
      const rawLine = lines[idx - 1];
      if (rawLine == null) continue;
      let parsed: JsonlLine;
      try {
        parsed = JSON.parse(rawLine) as JsonlLine;
      } catch {
        continue; // corrupted line — treat as tombstone (skip, id slot preserved)
      }
      if (isTombstone(parsed)) continue;
      rows.push({
        id: idx,
        task_id: parsed.taskId,
        conversation_id: this.conversationId,
        type: parsed.type,
        role: parsed.role,
        content: parsed.content,
        metadata: parsed.metadata,
        created_at: parsed.createdAt,
      });
    }
    return rows;
  }
}
