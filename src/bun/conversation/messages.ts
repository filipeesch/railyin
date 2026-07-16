import type { Database } from "bun:sqlite";

export function ensureTaskConversation(db: Database, taskId: number, conversationId: number | null): number {
  if (conversationId != null) {
    const existing = db
      .query<{ id: number }, [number, number]>(
        "SELECT id FROM conversations WHERE id = ? AND task_id = ?",
      )
      .get(conversationId, taskId);
    if (existing) return conversationId;
  }

  const convResult = db.run("INSERT INTO conversations (task_id) VALUES (?)", [taskId]);
  const ensuredConversationId = convResult.lastInsertRowid as number;
  db.run("UPDATE tasks SET conversation_id = ? WHERE id = ?", [ensuredConversationId, taskId]);
  return ensuredConversationId;
}
