import { appendStreamEventBatch } from "../db/stream-events.ts";
import type { StreamEvent, StreamEventType } from "../../shared/rpc-types.ts";

const PERSISTED_TYPES = new Set<StreamEventType>([
  "user", "assistant", "reasoning", "tool_call", "tool_result", "file_diff", "system",
]);

export class StreamBatcher {
  private buffer: StreamEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq: number;
  private blockCounters = { t: 0, r: 0, sa: 0 };
  private currentBlockType: "t" | "r" | "sa" | null = null;
  private currentBlockId: string = "";

  constructor(
    private readonly taskId: number,
    private readonly executionId: number,
    private readonly onFlush: (events: StreamEvent[]) => void,
    seqStart = 0,
  ) {
    this.seq = seqStart;
  }

  private nextSeq(): number {
    return this.seq++;
  }

  private getBlockId(type: StreamEventType, overrideBlockId?: string): string {
    // Empty string means "don't override, generate one"; only non-empty strings are actual overrides
    if (overrideBlockId && overrideBlockId !== "") return overrideBlockId;

    if (type === "text_chunk" || type === "assistant" || type === "user" || type === "system") {
      if (this.currentBlockType !== "t") {
        this.currentBlockType = "t";
        this.blockCounters.t++;
        this.currentBlockId = `${this.executionId}-t${this.blockCounters.t}`;
      }
      return this.currentBlockId;
    }

    if (type === "reasoning_chunk" || type === "reasoning") {
      if (this.currentBlockType !== "r") {
        this.currentBlockType = "r";
        this.blockCounters.r++;
        this.currentBlockId = `${this.executionId}-r${this.blockCounters.r}`;
      }
      return this.currentBlockId;
    }

    if (type === "status_chunk") {
      return `${this.executionId}-status`;
    }

    if (type === "done") {
      return `${this.executionId}-done`;
    }

    // tool_call, tool_result, file_diff use an explicit blockId passed in
    return `${this.executionId}-t${this.blockCounters.t}`;
  }

  push(partial: {
    type: StreamEventType;
    content?: string;
    metadata?: string | null;
    parentBlockId?: string | null;
    subagentId?: string | null;
    done?: boolean;
    blockId?: string;
  }): void {
    // Tool/file events break the current text block — next text needs a new blockId
    if (partial.type === "tool_call" || partial.type === "file_diff") {
      this.currentBlockType = null;
    }

    const blockId = this.getBlockId(partial.type, partial.blockId);
    const event: StreamEvent = {
      taskId: this.taskId,
      executionId: this.executionId,
      seq: this.nextSeq(),
      blockId,
      type: partial.type,
      content: partial.content ?? "",
      metadata: partial.metadata ?? null,
      parentBlockId: partial.parentBlockId ?? null,
      subagentId: partial.subagentId ?? null,
      done: partial.done ?? (partial.type === "done"),
    };

    this.buffer.push(event);

    // Force immediate flush at tool boundaries so the DB reflects accumulated reasoning/tokens
    // before the tool block, without waiting for the 500ms timer.
    if (event.type === "tool_call" || event.type === "tool_result") {
      this.flush();
    }

    if (event.done) {
      this.stop();
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    const persisted = batch.filter((e) => PERSISTED_TYPES.has(e.type));
    if (persisted.length > 0) {
      appendStreamEventBatch(persisted.map((e) => ({
        taskId: e.taskId,
        executionId: e.executionId,
        seq: e.seq,
        blockId: e.blockId,
        type: e.type,
        content: e.content,
        metadata: e.metadata,
        parentBlockId: e.parentBlockId,
        subagentId: e.subagentId,
      })));
    }
    this.onFlush(batch);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), 500);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}
