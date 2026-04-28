import type { StreamEventType } from "../../shared/rpc-types.ts";

export interface EnrichedEvent {
  seq: number;
  blockId: string;
}

export class StreamEventEnricher {
  private seq = 0;
  private blockCounters = { t: 0, r: 0, sa: 0 };
  private currentBlockType: "t" | "r" | "sa" | null = null;
  private currentBlockId = "";

  constructor(private readonly executionId: number) {}

  private nextSeq(): number {
    return this.seq++;
  }

  private getBlockId(type: StreamEventType, overrideBlockId?: string): string {
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

    // tool_call, tool_result, file_diff, and others use explicit blockId passed in
    return `${this.executionId}-t${this.blockCounters.t}`;
  }

  enrich(
    type: StreamEventType,
    overrideBlockId?: string,
  ): EnrichedEvent {
    // tool_call and file_diff break the current text block
    if (type === "tool_call" || type === "file_diff") {
      this.currentBlockType = null;
    }

    return {
      seq: this.nextSeq(),
      blockId: this.getBlockId(type, overrideBlockId),
    };
  }
}
