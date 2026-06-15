import type { Database } from "bun:sqlite";
import { getDb } from "../index.ts";

interface CursorSessionRow {
  conversation_id: number;
  agent_id: string;
  created_at: string;
  last_used_at: string;
}

export class CursorSessionRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  getAgentId(conversationId: number): string | null {
    const row = this.db
      .query<CursorSessionRow, [number]>(
        "SELECT * FROM cursor_sessions WHERE conversation_id = ?",
      )
      .get(conversationId);
    return row?.agent_id ?? null;
  }

  upsert(conversationId: number, agentId: string): void {
    this.db.run(
      "INSERT INTO cursor_sessions (conversation_id, agent_id) VALUES (?, ?)" +
        " ON CONFLICT(conversation_id) DO UPDATE SET agent_id = excluded.agent_id," +
        " last_used_at = datetime('now')",
      [conversationId, agentId],
    );
  }

  touch(conversationId: number): void {
    this.db.run(
      "UPDATE cursor_sessions SET last_used_at = datetime('now') WHERE conversation_id = ?",
      [conversationId],
    );
  }

  delete(conversationId: number): void {
    this.db.run("DELETE FROM cursor_sessions WHERE conversation_id = ?", [conversationId]);
  }
}
