import { getDb } from "../db/index.ts";
import type { ConversationMessage } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import { mapConversationMessage } from "../db/mappers.ts";
import { getStreamEvents, type PersistedStreamEvent } from "../db/stream-events.ts";

export function conversationHandlers() {
  return {
    "conversations.getMessages": async (params: {
      taskId: number;
    }): Promise<ConversationMessage[]> => {
      const db = getDb();
      return db
        .query<ConversationMessageRow, [number]>(
          "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
        )
        .all(params.taskId)
        .map(mapConversationMessage);
    },

    "conversations.getStreamEvents": async (params: {
      taskId: number;
      afterSeq?: number;
    }): Promise<PersistedStreamEvent[]> => {
      return getStreamEvents(params.taskId, params.afterSeq);
    },
  };
}
