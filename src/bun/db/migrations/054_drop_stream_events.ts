import type { Database } from "bun:sqlite";

export const id = "054_drop_stream_events";

/**
 * `stream_events` was originally a write-buffered durability aid for reconnect-mid-stream replay,
 * but `conversations.getStreamEvents` has no live caller in the frontend today (confirmed via
 * grep — only test/e2e mocks reference it) and the live-typing UX is served entirely by the
 * ephemeral per-token WebSocket broadcast, never by reading this table back. With durable
 * ordering now covered by the conversation message store itself, this table is dead weight and
 * is dropped entirely (not relocated) — there is no historical data worth migrating since it was
 * only ever a short-lived (4h) replay buffer.
 */
export function up(db: Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_stream_events_task;
    DROP INDEX IF EXISTS idx_stream_events_conversation;
    DROP INDEX IF EXISTS idx_stream_events_execution;
    DROP INDEX IF EXISTS idx_stream_events_conv_exec_seq;
    DROP TABLE IF EXISTS stream_events;
  `);
}
