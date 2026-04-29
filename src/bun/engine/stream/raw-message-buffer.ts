import type { Database, Statement } from "bun:sqlite";
import type { RawModelMessage } from "../types.ts";
import { WriteBuffer } from "../../pipeline/write-buffer.ts";
import type { WaitFn } from "../../pipeline/write-buffer.ts";

export interface RawMessageItem {
  taskId: number | null;
  conversationId: number;
  executionId: number;
  seq: number;
  raw: RawModelMessage;
}

export interface RawMessageBufferOptions {
  waitFn?: WaitFn;
  onEnqueue?: (item: RawMessageItem) => void;
}

export function createRawMessageBuffer(
  db: Database,
  opts?: RawMessageBufferOptions,
): WriteBuffer<RawMessageItem> {
  const stmt: Statement = db.prepare(
    `INSERT INTO model_raw_messages
       (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertBatch = db.transaction((items: RawMessageItem[]) => {
    for (const item of items) {
      stmt.run(
        item.taskId,
        item.executionId,
        item.raw.engine,
        item.raw.sessionId ?? null,
        item.seq,
        item.raw.direction,
        item.raw.eventType,
        item.raw.eventSubtype ?? null,
        JSON.stringify(item.raw.payload),
      );
    }
  });

  return new WriteBuffer<RawMessageItem>({
    maxBatch: 50,
    intervalMs: 1000,
    waitFn: opts?.waitFn,
    onEnqueue: opts?.onEnqueue,
    flushFn: (items) => insertBatch(items),
  });
}
