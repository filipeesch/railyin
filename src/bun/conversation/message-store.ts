import type { MessageType } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";

/**
 * Input shape for appending a new message. Deliberately excludes `id`/`conversation_id`/
 * `created_at` — the store implementation assigns those (id = line number for file-backed
 * stores, AUTOINCREMENT for legacy SQLite; conversationId is bound at store-construction time
 * via the resolver).
 */
export interface NewConversationMessageInput {
  taskId: number | null;
  type: MessageType;
  role: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * A single conversation's message storage, bound to one `conversationId` at construction time
 * (via the resolver in `message-store-resolver.ts`). Every method here operates only on that
 * conversation's messages — callers never pass a `conversationId` per call.
 *
 * Two implementations exist:
 *  - `FileConversationMessageStore` — new conversations, JSONL + sidecar on disk.
 *  - `LegacySqliteConversationMessageStore` — pre-existing conversations, wraps the existing
 *    `conversation_messages` SQL table for backward-compatible reads/writes.
 *
 * All I/O is async: the file-backed implementation performs real disk I/O serialized through
 * a per-conversation write queue (see `../utils/write-queue.ts`), and the interface is async
 * end-to-end so both implementations are interchangeable behind the same contract.
 */
export interface ConversationMessageStore {
  /** Append a single message. Returns the persisted row (with assigned id/createdAt). */
  append(input: NewConversationMessageInput): Promise<ConversationMessageRow>;

  /**
   * Append multiple messages as a single logical batch (used by `ConvMessageBuffer` to flush
   * buffered writes). Returns the persisted rows in the same order as the input.
   */
  appendBatch(inputs: NewConversationMessageInput[]): Promise<ConversationMessageRow[]>;

  /** Point lookup by message id. Returns `null` if not found. */
  getById(id: number): Promise<ConversationMessageRow | null>;

  /** Most recent message of the given type, or `null` if none exists. */
  getLastByType(type: MessageType): Promise<ConversationMessageRow | null>;

  /**
   * Messages with `id >= fromId`, ascending order, optionally capped by `limit` and/or
   * excluding messages with `id >= excludeFromId` (used for "history up to but not including
   * the just-appended message" reads).
   */
  getRange(fromId: number, opts?: { limit?: number; excludeFromId?: number }): Promise<ConversationMessageRow[]>;

  /**
   * Cursor-paginated read, newest-first semantics matching the existing `getMessages` RPC
   * contract: without `beforeMessageId`, returns the newest `limit` messages; with it, returns
   * up to `limit` messages with `id < beforeMessageId`. Rows are returned oldest-first within
   * the page (matching current handler behavior of `.reverse()`), with `hasMore` indicating
   * whether older messages remain.
   */
  getPage(opts: { beforeMessageId?: number; limit: number }): Promise<{ rows: ConversationMessageRow[]; hasMore: boolean }>;

  /** All messages for the conversation, optionally filtered by type, ascending order. */
  getAll(filter?: { types?: MessageType[] }): Promise<ConversationMessageRow[]>;

  /** Delete all messages for this conversation (used by legacy SQL cascade paths / tests). */
  deleteAll(): Promise<void>;
}
