import type { RawModelMessage } from "../types.ts";
import { WriteBuffer } from "../../pipeline/write-buffer.ts";
import type { WaitFn } from "../../pipeline/write-buffer.ts";
import type { RawMessageDebugLogWriter } from "../../conversation/raw-message-debug-log.ts";

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
  writer: RawMessageDebugLogWriter,
  opts?: RawMessageBufferOptions,
): WriteBuffer<RawMessageItem> {
  return new WriteBuffer<RawMessageItem>({
    maxBatch: 50,
    intervalMs: 1000,
    waitFn: opts?.waitFn,
    onEnqueue: opts?.onEnqueue,
    flushFn: (items) => writer.append(items),
  });
}

