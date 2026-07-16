import type { Database } from "bun:sqlite";
import type { MessageType } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import type { ConversationMessageStore, NewConversationMessageInput } from "./message-store.ts";

/**
 * Wraps the existing `conversation_messages` SQL table. Used for conversations created before
 * this change shipped (resolved via `message-store-resolver.ts`), so pre-existing conversations
 * keep working exactly as they did — this class intentionally preserves the query shapes that
 * were previously inlined across `context.ts`, `context-estimator.ts`, `cross-engine-context.ts`,
 * `decision-context-injector.ts`, `handlers/conversations.ts`, and `handlers/chat-sessions.ts`.
 */
export class LegacySqliteConversationMessageStore implements ConversationMessageStore {
  constructor(
    private readonly db: Database,
    private readonly conversationId: number,
  ) {}

  async append(input: NewConversationMessageInput): Promise<ConversationMessageRow> {
    const row = this.db
      .query<
        ConversationMessageRow,
        [number | null, number, string, string | null, string, string | null]
      >(
        `INSERT INTO conversation_messages (task_id, conversation_id, type, role, content, metadata)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.taskId,
        this.conversationId,
        input.type,
        input.role,
        input.content,
        input.metadata ? JSON.stringify(input.metadata) : null,
      );
    if (!row) throw new Error("Failed to insert conversation message");
    return row;
  }

  async appendBatch(inputs: NewConversationMessageInput[]): Promise<ConversationMessageRow[]> {
    if (inputs.length === 0) return [];
    const rows: ConversationMessageRow[] = [];
    this.db.transaction(() => {
      for (const input of inputs) {
        const row = this.db
          .query<
            ConversationMessageRow,
            [number | null, number, string, string | null, string, string | null]
          >(
            `INSERT INTO conversation_messages (task_id, conversation_id, type, role, content, metadata)
             VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
          )
          .get(
            input.taskId,
            this.conversationId,
            input.type,
            input.role,
            input.content,
            input.metadata ? JSON.stringify(input.metadata) : null,
          );
        if (row) rows.push(row);
      }
    })();
    return rows;
  }

  async getById(id: number): Promise<ConversationMessageRow | null> {
    const row = this.db
      .query<ConversationMessageRow, [number, number]>(
        "SELECT * FROM conversation_messages WHERE id = ? AND conversation_id = ?",
      )
      .get(id, this.conversationId);
    return row ?? null;
  }

  async getLastByType(type: MessageType): Promise<ConversationMessageRow | null> {
    const row = this.db
      .query<ConversationMessageRow, [number, string]>(
        "SELECT * FROM conversation_messages WHERE conversation_id = ? AND type = ? ORDER BY id DESC LIMIT 1",
      )
      .get(this.conversationId, type);
    return row ?? null;
  }

  async getRange(fromId: number, opts?: { limit?: number; excludeFromId?: number }): Promise<ConversationMessageRow[]> {
    const limit = opts?.limit ?? 200;
    if (opts?.excludeFromId != null) {
      return this.db
        .query<ConversationMessageRow, [number, number, number, number]>(
          "SELECT * FROM conversation_messages WHERE conversation_id = ? AND id >= ? AND id < ? ORDER BY id ASC LIMIT ?",
        )
        .all(this.conversationId, fromId, opts.excludeFromId, limit);
    }
    return this.db
      .query<ConversationMessageRow, [number, number, number]>(
        "SELECT * FROM conversation_messages WHERE conversation_id = ? AND id >= ? ORDER BY id ASC LIMIT ?",
      )
      .all(this.conversationId, fromId, limit);
  }

  async getPage(opts: { beforeMessageId?: number; limit: number }): Promise<{ rows: ConversationMessageRow[]; hasMore: boolean }> {
    const limit = opts.limit;
    let rows: ConversationMessageRow[];
    if (opts.beforeMessageId != null) {
      rows = this.db
        .query<ConversationMessageRow, [number, number, number]>(
          "SELECT * FROM conversation_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
        )
        .all(this.conversationId, opts.beforeMessageId, limit + 1);
    } else {
      rows = this.db
        .query<ConversationMessageRow, [number, number]>(
          "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
        )
        .all(this.conversationId, limit + 1);
    }
    const hasMore = rows.length > limit;
    return { rows: rows.slice(0, limit).reverse(), hasMore };
  }

  async getAll(filter?: { types?: MessageType[] }): Promise<ConversationMessageRow[]> {
    if (filter?.types && filter.types.length > 0) {
      const placeholders = filter.types.map(() => "?").join(", ");
      return this.db
        .query<ConversationMessageRow, (number | string)[]>(
          `SELECT * FROM conversation_messages WHERE conversation_id = ? AND type IN (${placeholders}) ORDER BY id ASC`,
        )
        .all(this.conversationId, ...filter.types);
    }
    return this.db
      .query<ConversationMessageRow, [number]>(
        "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC",
      )
      .all(this.conversationId);
  }

  async deleteAll(): Promise<void> {
    this.db.run("DELETE FROM conversation_messages WHERE conversation_id = ?", [this.conversationId]);
  }
}
