import type { Database } from "bun:sqlite";
import type { ConversationMessageRow } from "../db/row-types.ts";

const SYSTEM_MESSAGE_OVERHEAD_TOKENS = 400;

export class ContextEstimator {
  constructor(private readonly db: Database) {}

  estimate(
    conversationId: number,
    maxTokens: number,
  ): { usedTokens: number; maxTokens: number; fraction: number } {
    // Fast path: last completed execution input_tokens
    const recentExec = this.db
      .query<{ input_tokens: number | null }, [number]>(
        "SELECT input_tokens FROM executions WHERE conversation_id = ? AND status = 'completed' AND input_tokens IS NOT NULL ORDER BY id DESC LIMIT 1",
      )
      .get(conversationId);

    if (recentExec?.input_tokens != null) {
      const fraction = maxTokens > 0 ? Math.min(recentExec.input_tokens / maxTokens, 1) : 0;
      return { usedTokens: recentExec.input_tokens, maxTokens, fraction };
    }

    // Slow path: find last compaction_summary anchor, load up to 200 messages after it
    const anchor = this.db
      .query<{ id: number }, [number]>(
        "SELECT id FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
      )
      .get(conversationId);

    const messages = this.db
      .query<ConversationMessageRow, [number, number, number]>(
        "SELECT * FROM conversation_messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT ?",
      )
      .all(conversationId, anchor?.id ?? 0, 200);

    const totalChars = messages.reduce((sum, msg) => {
      const isToolMsg = msg.type === "tool_call" || msg.type === "tool_result";
      const chars = msg.content?.length ?? 0;
      return sum + (isToolMsg ? Math.ceil(chars / 3.5) : Math.ceil(chars / 4));
    }, 0);

    const usedTokens = Math.min(totalChars + SYSTEM_MESSAGE_OVERHEAD_TOKENS, maxTokens);
    const fraction = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
    return { usedTokens, maxTokens, fraction };
  }
}
