import type { Db } from "./db.ts";

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

export async function appendStreamEvent(db: Db, event: PersistedStreamEvent): Promise<number> {
  const result = await db.exec(
    `INSERT OR IGNORE INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [event.conversationId, event.executionId, event.seq, event.blockId, event.type, event.content, event.metadata ?? null, event.parentBlockId ?? null, event.subagentId ?? null],
  );
  return result.lastInsertRowid as number;
}

export async function appendStreamEventBatch(db: Db, events: PersistedStreamEvent[]): Promise<void> {
  if (events.length === 0) return;
  await db.begin(async (tx) => {
    for (const event of events) {
      await tx.exec(
        `INSERT OR IGNORE INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [event.conversationId, event.executionId, event.seq, event.blockId, event.type, event.content, event.metadata ?? null, event.parentBlockId ?? null, event.subagentId ?? null],
      );
    }
  });
}

export async function getStreamEventsByConversation(db: Db, conversationId: number, afterSeq?: number): Promise<PersistedStreamEvent[]> {
  const rows = await db.rows<{
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
  }>(
    "SELECT * FROM stream_events WHERE conversation_id = $1 AND execution_id = (SELECT MAX(execution_id) FROM stream_events WHERE conversation_id = $2) AND seq > $3 ORDER BY seq ASC",
    [conversationId, conversationId, afterSeq ?? -1],
  );

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
