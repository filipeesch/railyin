import type { Database } from "bun:sqlite";
import type { WaitFn } from "../pipeline/write-buffer.ts";

const defaultWaitFn: WaitFn = (ms) => new Promise((r) => setTimeout(r, ms));

const HOUR_MS = 60 * 60_000;
const DEFAULT_STARTUP_DELAY_MS = 5 * 60_000;
const DELETE_BATCH_SIZE = 500;

/**
 * Background cleanup for old DB rows, moved off the hot write path.
 *
 * All deletes run in short auto-commit batches so the SQLite write lock is
 * never held for a long transaction, and every phase is error-safe: a failure
 * (e.g. SQLITE_BUSY) is logged and the job continues with the next phase —
 * a cleanup run can never crash the server or kill the background loop.
 */
export class RetentionJob {
  private running = false;
  private tickResolve: (() => void) | null = null;
  private readonly waitFn: WaitFn;

  constructor(
    private readonly db: Database,
    waitFn?: WaitFn,
  ) {
    this.waitFn = waitFn ?? defaultWaitFn;
  }

  runNow(): void {
    this.runPhase("stream_events", () => {
      this.deleteBatched(
        `DELETE FROM stream_events WHERE created_at < datetime('now', '-4 hours')`,
      );
    });

    this.runPhase("archived chat sessions", () => {
      // Collect conversation IDs owned by expired archived chat sessions, then delete
      // the chat sessions first (to free the FK reference), then clean up executions
      // (no FK cascade in production — must be explicit), then delete the conversations
      // so that ON DELETE CASCADE propagates to conversation_messages and stream_events.
      const staleConversationIds = this.db
        .query<{ conversation_id: number }, []>(
          `SELECT conversation_id FROM chat_sessions
           WHERE status = 'archived' AND archived_at < datetime('now', '-7 days')`,
        )
        .all()
        .map((r) => r.conversation_id);

      this.deleteBatched(
        `DELETE FROM chat_sessions WHERE status = 'archived' AND archived_at < datetime('now', '-7 days')`,
      );

      for (let i = 0; i < staleConversationIds.length; i += DELETE_BATCH_SIZE) {
        const chunk = staleConversationIds.slice(i, i + DELETE_BATCH_SIZE);
        const placeholders = chunk.map(() => "?").join(", ");
        // Delete task_execution_checkpoints before executions (no ON DELETE CASCADE on execution_id)
        this.db.run(
          `DELETE FROM task_execution_checkpoints WHERE execution_id IN (SELECT id FROM executions WHERE conversation_id IN (${placeholders}))`,
          chunk,
        );
        // executions.conversation_id has no FK cascade — delete explicitly
        this.db.run(
          `DELETE FROM executions WHERE conversation_id IN (${placeholders})`,
          chunk,
        );
        this.db.run(`DELETE FROM conversations WHERE id IN (${placeholders})`, chunk);
      }
    });
  }

  /**
   * Starts the background loop. The first cleanup is deferred by
   * `startupDelayMs` (default 5 minutes) so server startup never blocks on a
   * full-scan DELETE; subsequent runs repeat every hour.
   */
  start(startupDelayMs: number = DEFAULT_STARTUP_DELAY_MS): void {
    if (this.running) return;
    this.running = true;
    void this._loop(startupDelayMs);
  }

  stop(): void {
    this.running = false;
    this._tick();
  }

  private runPhase(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[retention] cleanup phase failed (${label}):`, err);
    }
  }

  /** Runs a DELETE repeatedly (LIMIT-batched, auto-commit per statement) until
   *  no more rows match. Keeps each write lock acquisition short. */
  private deleteBatched(sql: string): void {
    let changes = -1;
    while (changes !== 0) {
      changes = this.db.run(`${sql} LIMIT ${DELETE_BATCH_SIZE}`).changes;
    }
  }

  private _tick(): void {
    if (this.tickResolve) {
      const resolve = this.tickResolve;
      this.tickResolve = null;
      resolve();
    }
  }

  private _wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.tickResolve = resolve;
      this.waitFn(ms).then(() => {
        if (this.tickResolve === resolve) {
          this.tickResolve = null;
          resolve();
        }
      });
    });
  }

  private async _loop(initialDelayMs: number): Promise<void> {
    await this._wait(initialDelayMs);
    while (this.running) {
      try {
        this.runNow();
      } catch (err) {
        // runNow is internally phase-safe; this guards the loop itself so a
        // runaway failure can never kill the background job.
        console.error("[retention] cleanup run failed:", err);
      }
      await this._wait(HOUR_MS);
    }
  }
}
