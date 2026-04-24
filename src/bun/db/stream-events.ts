import { getDb } from "./index.ts";

export interface PersistedStreamEvent {
  id?: number;
  conversationId: number;
  executionId: number;
  seq: number;
  blockId: string;
  type: string;
  content: string;
  metadata: string | null;
  parentBlockId?: string | null;
  subagentId: string | null;
  createdAt?: string;
}

export function appendStreamEvent(event: PersistedStreamEvent): number {
  const db = getDb();
  const result = db.run(
    `INSERT OR IGNORE INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.conversationId, event.executionId, event.seq, event.blockId, event.type, event.content, event.metadata ?? null, event.parentBlockId ?? null, event.subagentId ?? null],
  );
  return result.lastInsertRowid as number;
}

export function appendStreamEventBatch(events: PersistedStreamEvent[]): void {
  if (events.length === 0) return;
  const db = getDb();
  db.transaction(() => {
    for (const event of events) {
      db.run(
        `INSERT OR IGNORE INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event.conversationId, event.executionId, event.seq, event.blockId, event.type, event.content, event.metadata ?? null, event.parentBlockId ?? null, event.subagentId ?? null],
      );
    }
  })();
}

export function getStreamEventsByConversation(conversationId: number, afterSeq?: number): PersistedStreamEvent[] {
  const db = getDb();
  const rows = db.query<{
    id: number;
    conversation_id: number;
    execution_id: number;
    seq: number;
    block_id: string;
    type: string;
    content: string;
    metadata: string | null;
    parent_block_id: string | null;
    subagent_id: string | null;
    created_at: string;
  }, [number, number, number]>(
    "SELECT * FROM stream_events WHERE conversation_id = ? AND execution_id = (SELECT MAX(execution_id) FROM stream_events WHERE conversation_id = ?) AND seq > ? ORDER BY seq ASC",
  ).all(conversationId, conversationId, afterSeq ?? -1);

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    executionId: r.execution_id,
    seq: r.seq,
    blockId: r.block_id,
    type: r.type,
    content: r.content,
    metadata: r.metadata,
    parentBlockId: r.parent_block_id,
    subagentId: r.subagent_id,
    createdAt: r.created_at,
  }));
}
