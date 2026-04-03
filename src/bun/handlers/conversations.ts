import { getDb } from "../db/index.ts";
import type { ConversationMessage } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import { mapConversationMessage } from "../db/mappers.ts";

export function conversationHandlers() {
  return {
    "conversations.getMessages": async (params: {
      taskId: number;
    }): Promise<ConversationMessage[]> => {
      const db = getDb();
      return db
        .query<ConversationMessageRow, [number]>(
          "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY created_at ASC",
        )
        .all(params.taskId)
        .map(mapConversationMessage);
    },
  };
}
