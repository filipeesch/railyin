import type { IBroadcastChannel } from "./broadcast-channel.ts";
import { StreamEventEnricher } from "../pipeline/stream-event-enricher.ts";
import type { RawMessageItem } from "../engine/stream/raw-message-buffer.ts";
import type { StreamEvent, StreamEventType } from "../../shared/rpc-types.ts";

export class StreamEventProcessor {
  private readonly enrichers = new Map<number, StreamEventEnricher>();
  private markClaudeExecutionFn: ((id: number) => void) | null = null;

  constructor(private readonly channel: IBroadcastChannel) {}

  onStreamEvent(event: StreamEvent): void {
    let enricher = this.enrichers.get(event.executionId);
    if (!enricher) {
      enricher = new StreamEventEnricher(event.executionId);
      this.enrichers.set(event.executionId, enricher);
    }
    const { seq, blockId } = enricher.enrich(event.type, event.blockId || undefined);
    const enrichedEvent: StreamEvent = { ...event, seq, blockId };

    this.channel.broadcast({ type: "stream.event", payload: enrichedEvent });

    if (event.done) {
      this.enrichers.delete(event.executionId);
    }
  }

  onRawMessageEnqueued(item: RawMessageItem): void {
    let eventType: StreamEventType | null = null;
    let content: string | null = null;

    if (item.raw.engine === "claude") {
      const evt = (item.raw.payload as any)?.event;
      if (evt?.type !== "content_block_delta") return;
      const delta = evt.delta;
      if (delta?.type === "text_delta" && delta.text) {
        eventType = "text_chunk";
        content = delta.text as string;
      } else if (delta?.type === "thinking_delta" && delta.thinking) {
        eventType = "reasoning_chunk";
        content = delta.thinking as string;
      }
    } else if (item.raw.engine === "copilot") {
      const eventTypeName = item.raw.eventType;
      if (eventTypeName === "assistant.message_delta") {
        eventType = "text_chunk";
        content = (item.raw.payload as any)?.data?.deltaContent as string ?? null;
      } else if (eventTypeName === "assistant.reasoning_delta") {
        eventType = "reasoning_chunk";
        content = (item.raw.payload as any)?.data?.deltaContent as string ?? null;
      }
    }

    if (!eventType || !content) return;

    this.markClaudeExecutionFn?.(item.executionId);

    let enricher = this.enrichers.get(item.executionId);
    if (!enricher) {
      enricher = new StreamEventEnricher(item.executionId);
      this.enrichers.set(item.executionId, enricher);
    }
    const { seq, blockId } = enricher.enrich(eventType);
    this.channel.broadcast({
      type: "stream.event",
      payload: {
        taskId: item.taskId,
        conversationId: item.conversationId,
        executionId: item.executionId,
        seq,
        blockId,
        type: eventType,
        content,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done: false,
      },
    });
  }

  setMarkClaudeExecution(fn: (id: number) => void): void {
    this.markClaudeExecutionFn = fn;
  }
}
