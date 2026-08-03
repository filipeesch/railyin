import type { Db } from "../db/db.ts";
import type { MessageType } from "../../shared/rpc-types.ts";

export async function appendMessage(
  db: Db,
  taskId: number | null,
  conversationId: number,
  type: MessageType,
  role: string | null,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<number> {
  const result = await db.exec(
    `INSERT INTO conversation_messages (task_id, conversation_id, type, role, content, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [taskId, conversationId, type, role, content, metadata ? JSON.stringify(metadata) : null],
  );
  return result.lastInsertRowid as number;
}

export async function ensureTaskConversation(db: Db, taskId: number, conversationId: number | null): Promise<number> {
  if (conversationId != null) {
    const existing = await db.get<{ id: number }>(
      "SELECT id FROM conversations WHERE id = $1 AND task_id = $2",
      [conversationId, taskId],
    );
    if (existing) return conversationId;
  }

  const convResult = await db.exec("INSERT INTO conversations (task_id) VALUES ($1)", [taskId]);
  const ensuredConversationId = convResult.lastInsertRowid as number;
  await db.exec("UPDATE tasks SET conversation_id = $1 WHERE id = $2", [ensuredConversationId, taskId]);
  return ensuredConversationId;
}
