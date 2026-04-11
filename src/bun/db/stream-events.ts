import { getDb } from "./index.ts";

export interface PersistedStreamEvent {
  id?: number;
  taskId: number;
  executionId: number;
  seq: number;
  blockId: string;
  type: string;
  content: string;
  metadata: string | null;
  subagentId: string | null;
  createdAt?: string;
}

export function appendStreamEvent(event: PersistedStreamEvent): number {
  const db = getDb();
  const result = db.run(
    `INSERT OR IGNORE INTO stream_events (task_id, execution_id, seq, block_id, type, content, metadata, subagent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.taskId, event.executionId, event.seq, event.blockId, event.type, event.content, event.metadata ?? null, event.subagentId ?? null],
  );
  return result.lastInsertRowid as number;
}

export function appendStreamEventBatch(events: PersistedStreamEvent[]): void {
  if (events.length === 0) return;
  const db = getDb();
  db.transaction(() => {
    for (const event of events) {
      db.run(
        `INSERT OR IGNORE INTO stream_events (task_id, execution_id, seq, block_id, type, content, metadata, subagent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [event.taskId, event.executionId, event.seq, event.blockId, event.type, event.content, event.metadata ?? null, event.subagentId ?? null],
      );
    }
  })();
}

export function getStreamEvents(taskId: number, afterSeq?: number): PersistedStreamEvent[] {
  const db = getDb();
  const rows = db.query<{
    id: number;
    task_id: number;
    execution_id: number;
    seq: number;
    block_id: string;
    type: string;
    content: string;
    metadata: string | null;
    subagent_id: string | null;
    created_at: string;
  }, [number, number]>(
    "SELECT * FROM stream_events WHERE task_id = ? AND seq > ? ORDER BY seq ASC",
  ).all(taskId, afterSeq ?? -1);

  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    executionId: r.execution_id,
    seq: r.seq,
    blockId: r.block_id,
    type: r.type,
    content: r.content,
    metadata: r.metadata,
    subagentId: r.subagent_id,
    createdAt: r.created_at,
  }));
}
