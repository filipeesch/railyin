import type { Db } from "../../db/db.ts";
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
  db: Db,
  opts?: RawMessageBufferOptions,
): WriteBuffer<RawMessageItem> {
  const insertBatch = async (items: RawMessageItem[]): Promise<void> => {
    await db.begin(async (tx) => {
      for (const item of items) {
        await tx.exec(
          `INSERT INTO model_raw_messages
             (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            item.taskId,
            item.executionId,
            item.raw.engine,
            item.raw.sessionId ?? null,
            item.seq,
            item.raw.direction,
            item.raw.eventType,
            item.raw.eventSubtype ?? null,
            JSON.stringify(item.raw.payload),
          ],
        );
      }
    });
  };

  return new WriteBuffer<RawMessageItem>({
    maxBatch: 50,
    intervalMs: 1000,
    waitFn: opts?.waitFn,
    onEnqueue: opts?.onEnqueue,
    // Fire-and-forget: the DB write runs off the streaming hot path. WriteBuffer.flush()
    // invokes this synchronously and does not await, preserving non-blocking behavior.
    flushFn: (items) => {
      void insertBatch(items).catch((err) =>
        console.error("[raw-message-buffer] flush failed:", err),
      );
    },
  });
}
