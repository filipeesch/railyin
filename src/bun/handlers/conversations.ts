import { getDb } from "../db/index.ts";
import type { ConversationMessage } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import { mapConversationMessage } from "../db/mappers.ts";
import { getStreamEventsByConversation, type PersistedStreamEvent } from "../db/stream-events.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import { runWithConfig } from "../config/index.ts";
import { estimateConversationContextUsage, resolveContextWindow } from "../context-usage.ts";

function resolveConversationId(params: { conversationId?: number; taskId?: number }): number {
  if (params.conversationId != null) return params.conversationId;
  if (params.taskId == null) throw new Error("conversationId or taskId is required");

  const db = getDb();
  const row = db.query<{ conversation_id: number | null }, [number]>(
    "SELECT conversation_id FROM tasks WHERE id = ?",
  ).get(params.taskId);
  const conversationId = row?.conversation_id ?? null;
  if (conversationId == null) throw new Error(`Conversation not found for task ${params.taskId}`);
  return conversationId;
}

export function conversationHandlers(orchestrator: ExecutionCoordinator | null) {
  return {
    "conversations.getMessages": async (params: {
      conversationId?: number;
      taskId?: number;
    }): Promise<ConversationMessage[]> => {
      const db = getDb();
      const conversationId = resolveConversationId(params);
      return db
        .query<ConversationMessageRow, [number]>(
          "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC",
        )
        .all(conversationId)
        .map(mapConversationMessage);
    },

    "conversations.getStreamEvents": async (params: {
      conversationId?: number;
      taskId?: number;
      afterSeq?: number;
    }): Promise<PersistedStreamEvent[]> => {
      return getStreamEventsByConversation(resolveConversationId(params), params.afterSeq);
    },

    "conversations.contextUsage": async (params: {
      conversationId?: number;
      taskId?: number;
    }): Promise<{ usedTokens: number; maxTokens: number; fraction: number }> => {
      const db = getDb();
      const conversationId = resolveConversationId(params);
      const row = db.query<{
        task_model: string | null;
        task_workspace_key: string | null;
        session_workspace_key: string | null;
      }, [number]>(
        `SELECT
           t.model AS task_model,
           b.workspace_key AS task_workspace_key,
           cs.workspace_key AS session_workspace_key
         FROM conversations c
         LEFT JOIN tasks t ON t.conversation_id = c.id
         LEFT JOIN boards b ON b.id = t.board_id
         LEFT JOIN chat_sessions cs ON cs.conversation_id = c.id
         WHERE c.id = ?`,
      ).get(conversationId);

      const workspaceKey = row?.task_workspace_key ?? row?.session_workspace_key ?? getDefaultWorkspaceKey();
      const workspaceConfig = getWorkspaceConfig(workspaceKey);
      const configuredModel =
        row?.task_model
        ?? workspaceConfig.engine.model
        ?? workspaceConfig.workspace.default_model
        ?? null;

      const maxTokens = configuredModel
        ? await runWithConfig(workspaceConfig, async () => resolveContextWindow(configuredModel, workspaceKey, orchestrator))
        : 128_000;

      return estimateConversationContextUsage(conversationId, maxTokens);
    },
  };
}
