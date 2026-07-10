import type { MessageType } from "../../shared/rpc-types.ts";
import type { ConversationMessage } from "../../shared/rpc-types.ts";
import type { ConversationMessageStore } from "./message-store.ts";
import { mapConversationMessage } from "../db/mappers.ts";

export interface PendingConvMsg {
  taskId: number | null;
  type: MessageType;
  role: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  /** Whether to include this message in the flush return value for onNewMessage dispatch. */
  notify: boolean;
}

/**
 * Buffers pending message writes for a single conversation and flushes them as one batch via
 * the conversation's resolved `ConversationMessageStore`. Bound to one store instance (and
 * therefore one conversationId) at construction time — callers no longer pass `conversationId`
 * per message.
 */
export class ConvMessageBuffer {
  private pending: PendingConvMsg[] = [];

  constructor(private readonly store: ConversationMessageStore) {}

  enqueue(msg: PendingConvMsg): void {
    this.pending.push(msg);
  }

  /**
   * Flush all pending messages as a single batch. Returns only the messages marked with
   * notify=true, with their real ids assigned by the store.
   */
  async flush(): Promise<ConversationMessage[]> {
    if (this.pending.length === 0) return [];
    const items = this.pending.splice(0);

    const rows = await this.store.appendBatch(
      items.map((msg) => ({
        taskId: msg.taskId,
        type: msg.type,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata ?? null,
      })),
    );

    const notifyRows: ConversationMessage[] = [];
    for (let i = 0; i < items.length; i++) {
      if (!items[i].notify) continue;
      const row = rows[i];
      if (row) notifyRows.push(mapConversationMessage(row));
    }

    return notifyRows;
  }
}
