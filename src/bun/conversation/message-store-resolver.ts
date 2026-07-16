import type { Database } from "bun:sqlite";
import type { ConversationMessageStore } from "./message-store.ts";
import { LegacySqliteConversationMessageStore } from "./legacy-sqlite-message-store.ts";
import { FileConversationMessageStore } from "./file-message-store.ts";

export type StorageMedium = "sqlite" | "file";

/**
 * The single place in the codebase that decides whether a conversation's messages are
 * file-backed or legacy-SQLite-backed, and constructs the matching `ConversationMessageStore`
 * implementation. All call sites depend on this resolver (via constructor injection of the
 * resolved store, or by calling this function directly) instead of branching on storage medium
 * themselves.
 *
 * Discriminant: `conversations.storage_medium` column (added in migration
 * `052_conversation_storage_medium.ts`), defaulting to `'sqlite'` for every pre-existing row.
 */
export function resolveConversationMessageStore(db: Database, conversationId: number): ConversationMessageStore {
  const row = db
    .query<{ storage_medium: string }, [number]>(
      "SELECT storage_medium FROM conversations WHERE id = ?",
    )
    .get(conversationId);

  const medium: StorageMedium = row?.storage_medium === "file" ? "file" : "sqlite";

  if (medium === "file") {
    return new FileConversationMessageStore(conversationId);
  }
  return new LegacySqliteConversationMessageStore(db, conversationId);
}
