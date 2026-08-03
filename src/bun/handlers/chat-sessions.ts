import type { Db } from "../db/db.ts";
import type { ChatSession, ConversationMessage } from "../../shared/rpc-types.ts";
import type { ChatSessionRow, ConversationMessageRow } from "../db/row-types.ts";
import { mapChatSession, mapConversationMessage } from "../db/mappers.ts";
import { fetchChatSessionWithModel } from "../db/task-queries.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { prepareMessageForEngine } from "../utils/attachment-routing.ts";
import { QualifiedModelId } from "../engine/qualified-model-id.ts";
import { applyModelParamsPolicy } from "../conversation/model-params-policy.ts";

function autoTitle(): string {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'short' });
  const day = now.getDate();
  return `Chat – ${month} ${day}`;
}

export type OnChatSessionUpdated = (session: ChatSession) => void;

export function chatSessionHandlers(db: Db, onSessionUpdated: OnChatSessionUpdated, orchestrator: ExecutionCoordinator | null) {
  return {
    "chatSessions.list": async (params: { workspaceKey?: string; includeArchived?: boolean }): Promise<ChatSession[]> => {
      const wsKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const rows = await db.rows<ChatSessionRow>(
        params.includeArchived
          ? `SELECT cs.*, c.model AS conversation_model,
                    c.sampling_preset_override AS conversation_sampling_preset_override,
                    c.model_params AS conversation_model_params
              FROM chat_sessions cs
              LEFT JOIN conversations c ON c.id = cs.conversation_id
              WHERE cs.workspace_key = $1
              ORDER BY cs.last_activity_at DESC`
          : `SELECT cs.*, c.model AS conversation_model,
                    c.sampling_preset_override AS conversation_sampling_preset_override,
                    c.model_params AS conversation_model_params
              FROM chat_sessions cs
              LEFT JOIN conversations c ON c.id = cs.conversation_id
              WHERE cs.workspace_key = $1 AND cs.status != 'archived'
             ORDER BY cs.last_activity_at DESC`,
        [wsKey],
      );
      return rows.map(mapChatSession);
    },

    "chatSessions.create": async (params: { workspaceKey?: string; title?: string }): Promise<ChatSession> => {

      const wsKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const title = params.title ?? autoTitle();

      const session = await db.begin(async (tx) => {
        // Create conversation with no task
        const convResult = await tx.exec("INSERT INTO conversations (task_id) VALUES (NULL)");
        const conversationId = convResult.lastInsertRowid as number;

        // Seed the conversation model with the workspace default
        const workspaceConfig = getWorkspaceConfig(wsKey);
        const modelToSet = workspaceConfig.defaultModel ?? null;
        if (modelToSet) {
          await tx.exec("UPDATE conversations SET model = $1 WHERE id = $2", [modelToSet, conversationId]);
        }

        const sessionResult = await tx.exec(
          `INSERT INTO chat_sessions (workspace_key, title, status, conversation_id, enabled_mcp_tools, shell_auto_approve) VALUES ($1, $2, 'idle', $3, '[]', $4)`,
          [wsKey, title, conversationId, workspaceConfig.workspace.shell_auto_approve ? 1 : 0]
        );
        const sessionId = sessionResult.lastInsertRowid as number;

        return (await fetchChatSessionWithModel(tx, sessionId))!;
      });

      onSessionUpdated(session);
      return session;
    },

    "chatSessions.rename": async (params: { sessionId: number; title: string }): Promise<void> => {

      await db.exec("UPDATE chat_sessions SET title = $1 WHERE id = $2", [params.title, params.sessionId]);
      const updated = await fetchChatSessionWithModel(db, params.sessionId);
      if (updated) onSessionUpdated(updated);
    },

    "chatSessions.archive": async (params: { sessionId: number }): Promise<void> => {

      await db.exec(
        `UPDATE chat_sessions SET status = 'archived', archived_at = ${db.dialect.now()} WHERE id = $1`,
        [params.sessionId]
      );
      const updated = await fetchChatSessionWithModel(db, params.sessionId);
      if (updated) onSessionUpdated(updated);
    },

    "chatSessions.markRead": async (params: { sessionId: number }): Promise<void> => {

      await db.exec(
        `UPDATE chat_sessions SET last_read_at = ${db.dialect.now()} WHERE id = $1`,
        [params.sessionId]
      );
    },

    "chatSessions.get": async (params: { sessionId: number }): Promise<ChatSession> => {
      const row = await db.get<ChatSessionRow>(
        `SELECT cs.*, c.model AS conversation_model,
                c.sampling_preset_override AS conversation_sampling_preset_override,
                c.model_params AS conversation_model_params
         FROM chat_sessions cs
         LEFT JOIN conversations c ON c.id = cs.conversation_id
         WHERE cs.id = $1`,
        [params.sessionId],
      );
      if (!row) throw new Error(`Session ${params.sessionId} not found`);
      return mapChatSession(row);
    },

    "chatSessions.sendMessage": async (params: {
      sessionId: number;
      content: string;
      engineContent?: string;
      model?: string | null;
      attachments?: import("../../shared/rpc-types.ts").Attachment[];
    }): Promise<{ messageId: number; executionId: number }> => {
      const session = await db.get<ChatSessionRow & { conversation_model: string | null; conversation_sampling_preset_override: string | null }>(
        `SELECT cs.*, c.model AS conversation_model, c.sampling_preset_override AS conversation_sampling_preset_override, c.model_params AS conversation_model_params FROM chat_sessions cs LEFT JOIN conversations c ON c.id = cs.conversation_id WHERE cs.id = $1`,
        [params.sessionId],
      );
      if (!session) throw new Error(`Chat session ${params.sessionId} not found`);
      if (!orchestrator) throw new Error("Orchestrator not available");

      // Update session activity timestamp
      await db.exec(
        `UPDATE chat_sessions SET last_activity_at = ${db.dialect.now()} WHERE id = $1`,
        [params.sessionId]
      );

      // Trigger AI execution — orchestrator appends user message and returns executionId
      const { extractChips } = await import("../../mainview/utils/chat-chips.ts");
      const engine = QualifiedModelId.tryParse(session.conversation_model)?.engineId ?? "copilot";
      const promptContent = params.engineContent ?? extractChips(params.content).humanText;
      const prepared = await prepareMessageForEngine(engine, promptContent, params.attachments);
      const { message, executionId } = await orchestrator.executeChatTurn(
        params.sessionId,
        session.conversation_id,
        params.content,
        params.model ?? undefined,
        (() => {
          try {
            return session.enabled_mcp_tools ? JSON.parse(session.enabled_mcp_tools) : null;
          } catch {
            return null;
          }
        })(),
        session.workspace_key,
        prepared.attachments,
        prepared.content,
      );

      // Fetch updated session with model from conversation
      const updatedSession = await fetchChatSessionWithModel(db, params.sessionId);
      if (updatedSession) onSessionUpdated(updatedSession);

      return { messageId: message.id, executionId };
    },

    "chatSessions.submitDecisions": async (params: {
      sessionId: number;
      answers: import("../../shared/rpc-types.ts").DecisionAnswer[];
      generalNotes?: string;
    }): Promise<{ messageId: number; executionId: number }> => {
      const session = await db.get<ChatSessionRow & { conversation_model: string | null; conversation_sampling_preset_override: string | null }>(
        `SELECT cs.*, c.model AS conversation_model, c.sampling_preset_override AS conversation_sampling_preset_override, c.model_params AS conversation_model_params FROM chat_sessions cs LEFT JOIN conversations c ON c.id = cs.conversation_id WHERE cs.id = $1`,
        [params.sessionId],
      );
      if (!session) throw new Error(`Chat session ${params.sessionId} not found`);
      if (!orchestrator) throw new Error("Orchestrator not available");

      await db.exec(
        `UPDATE chat_sessions SET last_activity_at = ${db.dialect.now()} WHERE id = $1`,
        [params.sessionId]
      );

      const { buildDecisionSubmission } = await import("../conversation/decision-submission.ts");
      const { userContent, engineContent } = buildDecisionSubmission(params.answers, params.generalNotes);

      const engine = QualifiedModelId.tryParse(session.conversation_model)?.engineId ?? "copilot";
      const prepared = await prepareMessageForEngine(engine, engineContent, undefined);
      const { message, executionId } = await orchestrator.executeChatTurn(
        params.sessionId,
        session.conversation_id,
        userContent,
        undefined,
        (() => {
          try {
            return session.enabled_mcp_tools ? JSON.parse(session.enabled_mcp_tools) : null;
          } catch {
            return null;
          }
        })(),
        session.workspace_key,
        prepared.attachments,
        prepared.content,
      );

      const updatedSession = await fetchChatSessionWithModel(db, params.sessionId);
      if (updatedSession) onSessionUpdated(updatedSession);

      return { messageId: message.id, executionId };
    },

    "chatSessions.getMessages": async (params: {
      sessionId: number;
      beforeMessageId?: number;
      limit?: number;
    }): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> => {

      const session = await db.get<ChatSessionRow>(
        "SELECT conversation_id FROM chat_sessions WHERE id = $1",
        [params.sessionId],
      );
      if (!session) return { messages: [], hasMore: false };

      const limit = params.limit ?? 50;
      let rows: ConversationMessageRow[];
      if (params.beforeMessageId != null) {
        rows = await db.rows<ConversationMessageRow>(
          "SELECT * FROM conversation_messages WHERE conversation_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3",
          [session.conversation_id, params.beforeMessageId, limit + 1],
        );
      } else {
        rows = await db.rows<ConversationMessageRow>(
          "SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2",
          [session.conversation_id, limit + 1],
        );
      }
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse().map(mapConversationMessage);
      return { messages, hasMore };
    },

    "chatSessions.cancel": async (params: { sessionId: number }): Promise<void> => {

      const sessionRow = await db.get<ChatSessionRow>("SELECT * FROM chat_sessions WHERE id = $1", [params.sessionId]);
      if (!sessionRow) return;
      // Find the running execution for this conversation and cancel it via the orchestrator
      // so the streaming actually stops (not just the UI state).
      const execRow = await db.get<{ id: number }>(
        "SELECT id FROM executions WHERE conversation_id = $1 AND task_id IS NULL AND status = 'running' ORDER BY id DESC LIMIT 1",
        [sessionRow.conversation_id],
      );
      if (execRow && orchestrator) {
        orchestrator.cancel(execRow.id);
      } else {
        // No running execution found — just update DB status directly.
        await db.exec("UPDATE chat_sessions SET status = 'idle' WHERE id = $1 AND status = 'running'", [params.sessionId]);
        const updated = await fetchChatSessionWithModel(db, params.sessionId);
        if (updated) onSessionUpdated(updated);
      }
    },

    "chatSessions.compact": async (params: { sessionId: number }): Promise<void> => {

      const session = await db.get<ChatSessionRow>("SELECT * FROM chat_sessions WHERE id = $1", [params.sessionId]);
      if (!session) throw new Error(`Chat session ${params.sessionId} not found`);
      if (!orchestrator) throw new Error("Orchestrator not available");
      await orchestrator.compactConversation(session.conversation_id, session.workspace_key);
    },
    // ─── chatSessions.setModel ───────────────────────────────────────────────
    "chatSessions.setModel": async (params: { sessionId: number; model: string | null }): Promise<ChatSession> => {
      const session = await db.get<ChatSessionRow>("SELECT * FROM chat_sessions WHERE id = $1", [params.sessionId]);
      if (!session) throw new Error(`Chat session ${params.sessionId} not found`);
      if (session.conversation_id === null) {
        throw new Error(`Chat session ${params.sessionId} has no conversation`);
      }
      await db.exec("UPDATE conversations SET model = $1 WHERE id = $2", [params.model, session.conversation_id]);
      const engineModel = params.model && orchestrator
        ? (await orchestrator.listModels(session.workspace_key)).find((m) => m.qualifiedId === params.model)
        : undefined;
      await applyModelParamsPolicy(db, { conversationId: session.conversation_id, engineModel });
      const updated = await fetchChatSessionWithModel(db, params.sessionId);
      if (!updated) throw new Error(`Chat session ${params.sessionId} not found after update`);
      onSessionUpdated(updated);
      return updated;
    },

    // ─── chatSessions.setShellAutoApprove ────────────────────────────────────
    "chatSessions.setShellAutoApprove": async (params: { sessionId: number; enabled: boolean }): Promise<ChatSession> => {
      await db.exec(
        "UPDATE chat_sessions SET shell_auto_approve = $1 WHERE id = $2",
        [params.enabled ? 1 : 0, params.sessionId],
      );
      const updated = await fetchChatSessionWithModel(db, params.sessionId);
      if (!updated) throw new Error(`Chat session ${params.sessionId} not found`);
      onSessionUpdated(updated);
      return updated;
    },
  };
}

export function startChatSessionAutoArchiveJob(db: Db, onSessionUpdated: OnChatSessionUpdated): void {
  setInterval(async () => {
    try {

      const rows = await db.rows<ChatSessionRow>(
        `SELECT * FROM chat_sessions
         WHERE status != 'archived'
           AND last_activity_at < datetime('now', '-7 days')`
      );

      for (const row of rows) {
        await db.exec(
          `UPDATE chat_sessions SET status = 'archived', archived_at = ${db.dialect.now()} WHERE id = $1`,
          [row.id]
        );
        const updated = await fetchChatSessionWithModel(db, row.id);
        if (updated) onSessionUpdated(updated);
      }
    } catch (err) {
      console.error('[chat-sessions] auto-archive job error:', err);
    }
  }, 60 * 60 * 1000); // every hour
}
