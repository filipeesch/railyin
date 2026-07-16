import type { Database } from "bun:sqlite";
import { resolveConversationMessageStore } from "./message-store-resolver.ts";

const SYSTEM_MESSAGE_OVERHEAD_TOKENS = 400;

export class ContextEstimator {
  constructor(private readonly db: Database) {}

  async estimate(
    conversationId: number,
    maxTokens: number,
  ): Promise<{ usedTokens: number; maxTokens: number; fraction: number }> {
    // Fast path: last completed execution input_tokens
    const recentExec = this.db
      .query<{ input_tokens: number | null }, [number]>(
        "SELECT input_tokens FROM executions WHERE conversation_id = ? AND status = 'completed' AND input_tokens IS NOT NULL ORDER BY id DESC LIMIT 1",
      )
      .get(conversationId);

    if (recentExec?.input_tokens != null) {
      const usedTokens = Math.min(recentExec.input_tokens, maxTokens);
      const fraction = maxTokens > 0 ? Math.min(recentExec.input_tokens / maxTokens, 1) : 0;
      return { usedTokens, maxTokens, fraction };
    }

    // Slow path: find last compaction_summary anchor, load up to 200 messages after it
    const store = resolveConversationMessageStore(this.db, conversationId);
    const anchor = await store.getLastByType("compaction_summary");
    const messages = await store.getRange((anchor?.id ?? 0) + 1, { limit: 200 });

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
