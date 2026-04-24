import { getDb } from "./db/index.ts";
import type { ConversationMessageRow } from "./db/row-types.ts";
import { compactMessages, resolveModelContextWindow } from "./conversation/context.ts";
import type { ExecutionCoordinator } from "./engine/coordinator.ts";

const SYSTEM_MESSAGE_OVERHEAD_TOKENS = 400;

export async function resolveContextWindow(
  model: string,
  workspaceKey: string,
  orchestrator: ExecutionCoordinator | null,
): Promise<number> {
  if (orchestrator) {
    try {
      const models = await orchestrator.listModels(workspaceKey);
      const found = models.find((entry) => entry.qualifiedId === model);
      if (found?.contextWindow != null) return found.contextWindow;
    } catch {
      // fall through to direct resolution
    }
  }

  try {
    return await resolveModelContextWindow(model);
  } catch {
    return 128_000;
  }
}

export function estimateConversationContextUsage(
  conversationId: number,
  maxTokens: number,
): { usedTokens: number; maxTokens: number; fraction: number } {
  const db = getDb();

  const recentExec = db
    .query<{ input_tokens: number | null }, [number]>(
      "SELECT input_tokens FROM executions WHERE conversation_id = ? AND status = 'completed' AND input_tokens IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get(conversationId);

  if (recentExec?.input_tokens != null) {
    const usedTokens = recentExec.input_tokens;
    const fraction = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
    return { usedTokens, maxTokens, fraction };
  }

  const messages = db
    .query<ConversationMessageRow, [number]>(
      "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC",
    )
    .all(conversationId);

  const compacted = compactMessages(messages, { quiet: true });
  const totalChars = compacted.reduce((sum, message) => {
    if (typeof message.content === "string") return sum + message.content.length;
    return sum + JSON.stringify(message.content ?? "").length;
  }, 0);
  const usedTokens = Math.floor(totalChars / 4) + SYSTEM_MESSAGE_OVERHEAD_TOKENS;
  const fraction = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
  return { usedTokens, maxTokens, fraction };
}
