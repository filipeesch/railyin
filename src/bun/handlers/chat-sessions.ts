import type { Database } from "bun:sqlite";
import type { ChatSession, ConversationMessage } from "../../shared/rpc-types.ts";
import type { ChatSessionRow, ConversationMessageRow } from "../db/row-types.ts";
import { mapChatSession, mapConversationMessage } from "../db/mappers.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { prepareMessageForEngine } from "../utils/attachment-routing.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";

function autoTitle(): string {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'short' });
  const day = now.getDate();
  return `Chat – ${month} ${day}`;
}

export type OnChatSessionUpdated = (session: ChatSession) => void;

export function chatSessionHandlers(db: Database, onSessionUpdated: OnChatSessionUpdated, orchestrator: ExecutionCoordinator | null) {
  return {
    "chatSessions.list": async (params: { workspaceKey?: string; includeArchived?: boolean }): Promise<ChatSession[]> => {
      const wsKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const rows = db.query<ChatSessionRow, [string]>(
        params.includeArchived
          ? `SELECT cs.*, c.model AS conversation_model 
             FROM chat_sessions cs 
             LEFT JOIN conversations c ON c.id = cs.conversation_id 
             WHERE cs.workspace_key = ? 
             ORDER BY cs.last_activity_at DESC`
          : `SELECT cs.*, c.model AS conversation_model 
             FROM chat_sessions cs 
             LEFT JOIN conversations c ON c.id = cs.conversation_id 
             WHERE cs.workspace_key = ? AND cs.status != 'archived' 
             ORDER BY cs.last_activity_at DESC`
      ).all(wsKey);
      return rows.map(mapChatSession);
    },

    "chatSessions.create": async (params: { workspaceKey?: string; title?: string }): Promise<ChatSession> => {

      const wsKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const title = params.title ?? autoTitle();

      const session = db.transaction(() => {
        // Create conversation with no task
        const convResult = db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
        const conversationId = convResult.lastInsertRowid as number;

        // Seed the conversation model with the workspace default or engine model
        const workspaceConfig = getWorkspaceConfig(wsKey);
        const engineModel = "model" in workspaceConfig.engine ? (workspaceConfig.engine.model || null) : null;
        const modelToSet = workspaceConfig.workspace.default_model ?? engineModel ?? null;
        if (modelToSet) {
          db.run("UPDATE conversations SET model = ? WHERE id = ?", [modelToSet, conversationId]);
        }

        const sessionResult = db.run(
          `INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES (?, ?, 'idle', ?)`,
          [wsKey, title, conversationId]
        );
        const sessionId = sessionResult.lastInsertRowid as number;

        const row = db.query<ChatSessionRow, [number]>(
          "SELECT * FROM chat_sessions WHERE id = ?"
        ).get(sessionId);

        return mapChatSession(row!);
      })();

      onSessionUpdated(session);
      return session;
    },

    "chatSessions.rename": async (params: { sessionId: number; title: string }): Promise<void> => {

      db.run("UPDATE chat_sessions SET title = ? WHERE id = ?", [params.title, params.sessionId]);
      const row = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (row) onSessionUpdated(mapChatSession(row));
    },

    "chatSessions.archive": async (params: { sessionId: number }): Promise<void> => {

      db.run(
        "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now') WHERE id = ?",
        [params.sessionId]
      );
      const row = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (row) onSessionUpdated(mapChatSession(row));
    },

    "chatSessions.markRead": async (params: { sessionId: number }): Promise<void> => {

      db.run(
        "UPDATE chat_sessions SET last_read_at = datetime('now') WHERE id = ?",
        [params.sessionId]
      );
    },

    "chatSessions.get": async (params: { sessionId: number }): Promise<ChatSession> => {
      const row = db.query<ChatSessionRow, [number]>(
        `SELECT cs.*, c.model AS conversation_model 
         FROM chat_sessions cs 
         LEFT JOIN conversations c ON c.id = cs.conversation_id 
         WHERE cs.id = ?`
      ).get(params.sessionId);
      if (!row) throw new Error(`Session ${params.sessionId} not found`);
      return mapChatSession(row);
    },

    "chatSessions.sendMessage": async (params: {
      sessionId: number;
      content: string;
      engineContent?: string;
      model?: string | null;
      attachments?: import("../../shared/rpc-types.ts").Attachment[];
      decisionBatch?: { label?: string; records: import("../../shared/rpc-types.ts").DecisionInput[] };
    }): Promise<{ messageId: number; executionId: number }> => {
      const session = db.query<ChatSessionRow, [number]>(
        "SELECT * FROM chat_sessions WHERE id = ?"
      ).get(params.sessionId);
      if (!session) throw new Error(`Chat session ${params.sessionId} not found`);
      if (!orchestrator) throw new Error("Orchestrator not available");

      // Update session activity timestamp
      db.run(
        "UPDATE chat_sessions SET last_activity_at = datetime('now') WHERE id = ?",
        [params.sessionId]
      );

      // Trigger AI execution — orchestrator appends user message and returns executionId
      const { extractChips } = await import("../../mainview/utils/chat-chips.ts");
      const workspaceConfig = getWorkspaceConfig(session.workspace_key);
      const engine = workspaceConfig.engine.type;
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
      const updatedSession = db.query<ChatSessionRow, [number]>(
        `SELECT cs.*, c.model AS conversation_model 
         FROM chat_sessions cs 
         LEFT JOIN conversations c ON c.id = cs.conversation_id 
         WHERE cs.id = ?`
      ).get(params.sessionId);

      if (updatedSession) onSessionUpdated(mapChatSession(updatedSession));

      if (params.decisionBatch) {
        const decisionRepo = new DecisionRepository(db);
        const batch = decisionRepo.createBatch(session.conversation_id, params.decisionBatch.label);
        for (const record of params.decisionBatch.records) {
          decisionRepo.createRecord(session.conversation_id, {
            batchId: batch.id,
            question: record.question,
            answer: record.answer,
            weight: record.weight ?? "medium",
            notes: record.notes,
            isSourceAi: false,
          });
        }
      }

      return { messageId: message.id, executionId };
    },

    "chatSessions.getMessages": async (params: {
      sessionId: number;
      beforeMessageId?: number;
      limit?: number;
    }): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> => {

      const session = db.query<ChatSessionRow, [number]>(
        "SELECT conversation_id FROM chat_sessions WHERE id = ?"
      ).get(params.sessionId);
      if (!session) return { messages: [], hasMore: false };

      const limit = params.limit ?? 50;
      let rows: ConversationMessageRow[];
      if (params.beforeMessageId != null) {
        rows = db.query<ConversationMessageRow, [number, number, number]>(
          "SELECT * FROM conversation_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?"
        ).all(session.conversation_id, params.beforeMessageId, limit + 1);
      } else {
        rows = db.query<ConversationMessageRow, [number, number]>(
          "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?"
        ).all(session.conversation_id, limit + 1);
      }
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse().map(mapConversationMessage);
      return { messages, hasMore };
    },

    "chatSessions.cancel": async (params: { sessionId: number }): Promise<void> => {

      const sessionRow = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (!sessionRow) return;
      // Find the running execution for this conversation and cancel it via the orchestrator
      // so the streaming actually stops (not just the UI state).
      const execRow = db.query<{ id: number }, [number]>(
        "SELECT id FROM executions WHERE conversation_id = ? AND task_id IS NULL AND status = 'running' ORDER BY id DESC LIMIT 1"
      ).get(sessionRow.conversation_id);
      if (execRow && orchestrator) {
        orchestrator.cancel(execRow.id);
      } else {
        // No running execution found — just update DB status directly.
        db.run("UPDATE chat_sessions SET status = 'idle' WHERE id = ? AND status = 'running'", [params.sessionId]);
        const row = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
        if (row) onSessionUpdated(mapChatSession(row));
      }
    },

    "chatSessions.compact": async (params: { sessionId: number }): Promise<void> => {

      const session = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (!session) throw new Error(`Chat session ${params.sessionId} not found`);
      if (!orchestrator) throw new Error("Orchestrator not available");
      await orchestrator.compactConversation(session.conversation_id, session.workspace_key);
    },
    // ─── chatSessions.setModel ───────────────────────────────────────────────
    "chatSessions.setModel": async (params: { sessionId: number; model: string | null }): Promise<ChatSession> => {
      const session = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (!session) throw new Error(`Chat session ${params.sessionId} not found`);
      if (session.conversation_id === null) {
        throw new Error(`Chat session ${params.sessionId} has no conversation`);
      }
      db.run("UPDATE conversations SET model = ? WHERE id = ?", [params.model, session.conversation_id]);
      const updated = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (!updated) throw new Error(`Chat session ${params.sessionId} not found after update`);
      onSessionUpdated(mapChatSession(updated));
      return mapChatSession(updated);
    },
  };
}

export function startChatSessionAutoArchiveJob(db: Database, onSessionUpdated: OnChatSessionUpdated): void {
  setInterval(() => {
    try {

      const rows = db.query<ChatSessionRow, []>(
        `SELECT * FROM chat_sessions
         WHERE status != 'archived'
           AND last_activity_at < datetime('now', '-7 days')`
      ).all();

      for (const row of rows) {
        db.run(
          "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now') WHERE id = ?",
          [row.id]
        );
        const updated = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(row.id);
        if (updated) onSessionUpdated(mapChatSession(updated));
      }
    } catch (err) {
      console.error('[chat-sessions] auto-archive job error:', err);
    }
  }, 60 * 60 * 1000); // every hour
}
