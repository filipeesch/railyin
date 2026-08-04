import type { Db } from "../db/db.ts";
import type { ConversationMessage, ModelParamValue } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import { mapConversationMessage } from "../db/mappers.ts";
import { getStreamEventsByConversation, type PersistedStreamEvent } from "../db/stream-events.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import { runWithConfig } from "../config/index.ts";
import { resolveContextWindow } from "../context-usage.ts";
import { ContextEstimator } from "../conversation/context-estimator.ts";
import type { ModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";

export function conversationHandlers(db: Db, orchestrator: ExecutionCoordinator | null, modelSettingsRepo?: ModelSettingsRepository) {
  return {
    "conversations.getMessages": async (params: {
      conversationId?: number;
      taskId?: number;
      beforeMessageId?: number;
      limit?: number;
    }): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> => {
      let conversationId = params.conversationId;
      if (conversationId == null && params.taskId != null) {
        const row = await db.get<{ conversation_id: number }>(
          "SELECT conversation_id FROM tasks WHERE id = $1",
          [params.taskId],
        );
        if (!row) throw new Error(`Task ${params.taskId} not found`);
        conversationId = row.conversation_id;
      }
      if (conversationId == null) throw new Error("conversationId or taskId is required");
      const limit = params.limit ?? 50;
      let rows: ConversationMessageRow[];
      if (params.beforeMessageId != null) {
        rows = await db.rows<ConversationMessageRow>(
          "SELECT * FROM conversation_messages WHERE conversation_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3",
          [conversationId, params.beforeMessageId, limit + 1],
        );
      } else {
        rows = await db.rows<ConversationMessageRow>(
          "SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2",
          [conversationId, limit + 1],
        );
      }
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse().map(mapConversationMessage);
      return { messages, hasMore };
    },

    "conversations.getStreamEvents": async (params: {
      conversationId: number;
      afterSeq?: number;
    }): Promise<PersistedStreamEvent[]> => {
      return await getStreamEventsByConversation(db, params.conversationId, params.afterSeq);
    },

    "conversations.contextUsage": async (params: {
      conversationId: number;
    }): Promise<{ usedTokens: number; maxTokens: number; fraction: number }> => {
      const row = await db.get<{
        conversation_model: string | null;
        task_workspace_key: string | null;
        session_workspace_key: string | null;
      }>(
        `SELECT
           c.model AS conversation_model,
           b.workspace_key AS task_workspace_key,
           cs.workspace_key AS session_workspace_key
         FROM conversations c
         LEFT JOIN tasks t ON t.conversation_id = c.id
         LEFT JOIN boards b ON b.id = t.board_id
         LEFT JOIN chat_sessions cs ON cs.conversation_id = c.id
         WHERE c.id = $1`,
        [params.conversationId],
      );

      const workspaceKey = row?.task_workspace_key ?? row?.session_workspace_key ?? getDefaultWorkspaceKey();
      const workspaceConfig = getWorkspaceConfig(workspaceKey);
      
      // Model resolution: conversation.model (centralized storage for both tasks and chat sessions)
      const configuredModel = row?.conversation_model ?? workspaceConfig.workspace.default_model ?? null;
      const maxTokens = configuredModel 
        ? await runWithConfig(workspaceConfig, async () => resolveContextWindow(configuredModel, workspaceKey, orchestrator, modelSettingsRepo)) 
        : 128_000;
      
      return await new ContextEstimator(db).estimate(params.conversationId, maxTokens);
    },

    "conversations.setSamplingPreset": async (params: {
      conversationId: number;
      presetName: string | null;
    }): Promise<Record<string, never>> => {
      await db.exec(
        "UPDATE conversations SET sampling_preset_override = $1 WHERE id = $2",
        [params.presetName, params.conversationId],
      );
      return {};
    },

    "conversations.setModelParams": async (params: {
      conversationId: number;
      modelParams: ModelParamValue[];
    }): Promise<Record<string, never>> => {
      await db.exec(
        "UPDATE conversations SET model_params = $1 WHERE id = $2",
        [params.modelParams.length > 0 ? JSON.stringify(params.modelParams) : null, params.conversationId],
      );
      return {};
    },
  };
}
