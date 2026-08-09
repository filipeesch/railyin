import type { Database } from "bun:sqlite";
import type { ConversationMessage, ModelParamValue } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import { mapConversationMessage } from "../db/mappers.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import type { ModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";

export function conversationHandlers(db: Database, orchestrator: ExecutionCoordinator | null, modelSettingsRepo?: ModelSettingsRepository) {
  return {
    "conversations.getMessages": async (params: {
      conversationId?: number;
      taskId?: number;
      beforeMessageId?: number;
      limit?: number;
    }): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> => {
      let conversationId = params.conversationId;
      if (conversationId == null && params.taskId != null) {
        const row = db.query<{ conversation_id: number }, [number]>(
          "SELECT conversation_id FROM tasks WHERE id = ?",
        ).get(params.taskId);
        if (!row) throw new Error(`Task ${params.taskId} not found`);
        conversationId = row.conversation_id;
      }
      if (conversationId == null) throw new Error("conversationId or taskId is required");
      const limit = params.limit ?? 50;
      let rows: ConversationMessageRow[];
      if (params.beforeMessageId != null) {
        rows = db
          .query<ConversationMessageRow, [number, number, number]>(
            "SELECT * FROM conversation_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
          )
          .all(conversationId, params.beforeMessageId, limit + 1);
      } else {
        rows = db
          .query<ConversationMessageRow, [number, number]>(
            "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
          )
          .all(conversationId, limit + 1);
      }
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse().map(mapConversationMessage);
      return { messages, hasMore };
    },

    "conversations.setSamplingPreset": async (params: {
      conversationId: number;
      presetName: string | null;
    }): Promise<Record<string, never>> => {
      db.run(
        "UPDATE conversations SET sampling_preset_override = ? WHERE id = ?",
        [params.presetName, params.conversationId],
      );
      return {};
    },

    "conversations.setModelParams": async (params: {
      conversationId: number;
      modelParams: ModelParamValue[];
    }): Promise<Record<string, never>> => {
      db.run(
        "UPDATE conversations SET model_params = ? WHERE id = ?",
        [params.modelParams.length > 0 ? JSON.stringify(params.modelParams) : null, params.conversationId],
      );
      return {};
    },
  };
}
