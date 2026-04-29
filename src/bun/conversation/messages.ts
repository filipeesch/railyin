import type { Database } from "bun:sqlite";
import type { MessageType } from "../../shared/rpc-types.ts";

export function appendMessage(
  db: Database,
  taskId: number | null,
  conversationId: number,
  type: MessageType,
  role: string | null,
  content: string,
  metadata?: Record<string, unknown>,
): number {
  const result = db.run(
    `INSERT INTO conversation_messages (task_id, conversation_id, type, role, content, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [taskId, conversationId, type, role, content, metadata ? JSON.stringify(metadata) : null],
  );
  return result.lastInsertRowid as number;
}

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
