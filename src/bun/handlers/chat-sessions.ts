import { getDb } from "../db/index.ts";
import type { ChatSession, ConversationMessage } from "../../shared/rpc-types.ts";
import type { ChatSessionRow, ConversationMessageRow } from "../db/row-types.ts";
import { mapChatSession, mapConversationMessage } from "../db/mappers.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";
import type { Orchestrator } from "../engine/orchestrator.ts";

function autoTitle(): string {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'short' });
  const day = now.getDate();
  return `Chat – ${month} ${day}`;
}

export type OnChatSessionUpdated = (session: ChatSession) => void;

export function chatSessionHandlers(onSessionUpdated: OnChatSessionUpdated, orchestrator: Orchestrator | null) {
  return {
    "chatSessions.list": async (params: { workspaceKey?: string; includeArchived?: boolean }): Promise<ChatSession[]> => {
      const db = getDb();
      const wsKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const rows = db.query<ChatSessionRow, [string]>(
        params.includeArchived
          ? "SELECT * FROM chat_sessions WHERE workspace_key = ? ORDER BY last_activity_at DESC"
          : "SELECT * FROM chat_sessions WHERE workspace_key = ? AND status != 'archived' ORDER BY last_activity_at DESC"
      ).all(wsKey);
      return rows.map(mapChatSession);
    },

    "chatSessions.create": async (params: { workspaceKey?: string; title?: string }): Promise<ChatSession> => {
      const db = getDb();
      const wsKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const title = params.title ?? autoTitle();

      const session = db.transaction(() => {
        // Create conversation with no task
        const convResult = db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
        const conversationId = convResult.lastInsertRowid as number;

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
      const db = getDb();
      db.run("UPDATE chat_sessions SET title = ? WHERE id = ?", [params.title, params.sessionId]);
      const row = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (row) onSessionUpdated(mapChatSession(row));
    },

    "chatSessions.archive": async (params: { sessionId: number }): Promise<void> => {
      const db = getDb();
      db.run(
        "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now') WHERE id = ?",
        [params.sessionId]
      );
      const row = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (row) onSessionUpdated(mapChatSession(row));
    },

    "chatSessions.markRead": async (params: { sessionId: number }): Promise<void> => {
      const db = getDb();
      db.run(
        "UPDATE chat_sessions SET last_read_at = datetime('now') WHERE id = ?",
        [params.sessionId]
      );
    },

    "chatSessions.sendMessage": async (params: {
      sessionId: number;
      content: string;
      model?: string | null;
      attachments?: import("../../shared/rpc-types.ts").Attachment[];
    }): Promise<{ message: ConversationMessage; executionId: number }> => {
      const db = getDb();
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
      const { message, executionId } = await orchestrator.executeChatTurn(
        params.sessionId,
        session.conversation_id,
        params.content,
        params.model ?? undefined,
        (() => { try { return session.enabled_mcp_tools ? JSON.parse(session.enabled_mcp_tools) : null; } catch { return null; } })(),
        session.workspace_key,
        params.attachments,
      );

      const updatedSession = db.query<ChatSessionRow, [number]>(
        "SELECT * FROM chat_sessions WHERE id = ?"
      ).get(params.sessionId);
      if (updatedSession) onSessionUpdated(mapChatSession(updatedSession));

      return { message, executionId };
    },

    "chatSessions.getMessages": async (params: { sessionId: number }): Promise<ConversationMessage[]> => {
      const db = getDb();
      const session = db.query<ChatSessionRow, [number]>(
        "SELECT conversation_id FROM chat_sessions WHERE id = ?"
      ).get(params.sessionId);
      if (!session) return [];

      return db.query<ConversationMessageRow, [number]>(
        "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC"
      ).all(session.conversation_id).map(mapConversationMessage);
    },

    "chatSessions.cancel": async (params: { sessionId: number }): Promise<void> => {
      const db = getDb();
      db.run(
        "UPDATE chat_sessions SET status = 'idle' WHERE id = ? AND status = 'running'",
        [params.sessionId]
      );
      const row = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (row) onSessionUpdated(mapChatSession(row));
    },

    "chatSessions.compact": async (params: { sessionId: number }): Promise<void> => {
      const db = getDb();
      const session = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (!session) throw new Error(`Chat session ${params.sessionId} not found`);
      if (!orchestrator) throw new Error("Orchestrator not available");
      await orchestrator.compactConversation(session.conversation_id, session.workspace_key);
    },
  };
}

export function startChatSessionAutoArchiveJob(onSessionUpdated: OnChatSessionUpdated): void {
  setInterval(() => {
    try {
      const db = getDb();
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
