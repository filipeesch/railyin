import type { Db } from "../db/db.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";

const SYSTEM_MESSAGE_OVERHEAD_TOKENS = 400;

export class ContextEstimator {
  constructor(private readonly db: Db) {}

  async estimate(
    conversationId: number,
    maxTokens: number,
  ): Promise<{ usedTokens: number; maxTokens: number; fraction: number }> {
    // Fast path: last completed execution input_tokens
    const recentExec = await this.db
      .get<{ input_tokens: number | null }>(
        "SELECT input_tokens FROM executions WHERE conversation_id = $1 AND status = 'completed' AND input_tokens IS NOT NULL ORDER BY id DESC LIMIT 1",
        [conversationId],
      );

    if (recentExec?.input_tokens != null) {
      const usedTokens = Math.min(recentExec.input_tokens, maxTokens);
      const fraction = maxTokens > 0 ? Math.min(recentExec.input_tokens / maxTokens, 1) : 0;
      return { usedTokens, maxTokens, fraction };
    }

    // Slow path: find last compaction_summary anchor, load up to 200 messages after it
    const anchor = await this.db
      .get<{ id: number }>(
        "SELECT id FROM conversation_messages WHERE conversation_id = $1 AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
        [conversationId],
      );

    const messages = await this.db
      .rows<ConversationMessageRow>(
        "SELECT * FROM conversation_messages WHERE conversation_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3",
        [conversationId, anchor?.id ?? 0, 200],
      );

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
