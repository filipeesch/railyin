import type { Database } from "bun:sqlite";
import type { MessageType } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import { mapConversationMessage } from "../db/mappers.ts";
import type { ConversationMessage } from "../../shared/rpc-types.ts";

export interface PendingConvMsg {
  taskId: number | null;
  conversationId: number;
  type: MessageType;
  role: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  /** Whether to include this message in the flush return value for onNewMessage dispatch. */
  notify: boolean;
}

export class ConvMessageBuffer {
  private pending: PendingConvMsg[] = [];

  constructor(private readonly db: Database) {}

  enqueue(msg: PendingConvMsg): void {
    this.pending.push(msg);
  }

  /**
   * Flush all pending messages in a single transaction.
   * Returns only the messages marked with notify=true, with their real DB IDs.
   */
  flush(): ConversationMessage[] {
    if (this.pending.length === 0) return [];
    const items = this.pending.splice(0);
    const notifyRows: ConversationMessage[] = [];

    this.db.transaction(() => {
      for (const msg of items) {
        const row = this.db
          .query<
            ConversationMessageRow,
            [number | null, number, string, string | null, string, string | null]
          >(
            `INSERT INTO conversation_messages (task_id, conversation_id, type, role, content, metadata)
             VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
          )
          .get(
            msg.taskId,
            msg.conversationId,
            msg.type,
            msg.role,
            msg.content,
            msg.metadata ? JSON.stringify(msg.metadata) : null,
          );
        if (row && msg.notify) {
          notifyRows.push(mapConversationMessage(row));
        }
      }
    })();

    return notifyRows;
  }
}
