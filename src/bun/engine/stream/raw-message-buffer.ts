import type { Database } from "bun:sqlite";
import type { RawModelMessage } from "../types.ts";
import { WriteBuffer } from "../../pipeline/write-buffer.ts";
import type { WaitFn } from "../../pipeline/write-buffer.ts";

export interface RawMessageItem {
  taskId: number | null;
  executionId: number;
  seq: number;
  raw: RawModelMessage;
}

export function createRawMessageBuffer(
  db: Database,
  waitFn?: WaitFn,
): WriteBuffer<RawMessageItem> {
  return new WriteBuffer<RawMessageItem>({
    maxBatch: 50,
    intervalMs: 1000,
    waitFn,
    flushFn: (items) => {
      db.transaction(() => {
        for (const item of items) {
          db.run(
            `INSERT INTO model_raw_messages
               (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      })();
    },
  });
}
