import type { Db } from "../db/db.ts";
import type { WaitFn } from "../pipeline/write-buffer.ts";

const defaultWaitFn: WaitFn = (ms) => new Promise((r) => setTimeout(r, ms));

export class RetentionJob {
  private running = false;
  private tickResolve: (() => void) | null = null;
  private readonly waitFn: WaitFn;

  constructor(
    private readonly db: Db,
    waitFn?: WaitFn,
  ) {
    this.waitFn = waitFn ?? defaultWaitFn;
  }

  async runNow(): Promise<void> {
    await this.db.exec("DELETE FROM model_raw_messages WHERE created_at < datetime('now', '-1 day')");
    await this.db.exec("DELETE FROM stream_events WHERE created_at < datetime('now', '-4 hours')");
    // Collect conversation IDs owned by expired archived chat sessions, then delete
    // the chat sessions first (to free the FK reference), then clean up executions
    // (no FK cascade in production — must be explicit), then delete the conversations
    // so that ON DELETE CASCADE propagates to conversation_messages and stream_events.
    const staleConversationIds = (await this.db.rows<{ conversation_id: number }>(
      `SELECT conversation_id FROM chat_sessions
         WHERE status = 'archived' AND archived_at < datetime('now', '-7 days')`,
    )).map((r) => r.conversation_id);

    await this.db.exec(
      "DELETE FROM chat_sessions WHERE status = 'archived' AND archived_at < datetime('now', '-7 days')"
    );

    if (staleConversationIds.length > 0) {
      const placeholders = staleConversationIds.map((_, i) => `$${i + 1}`).join(", ");
      // Delete task_execution_checkpoints before executions (no ON DELETE CASCADE on execution_id)
      await this.db.exec(
        `DELETE FROM task_execution_checkpoints WHERE execution_id IN (SELECT id FROM executions WHERE conversation_id IN (${placeholders}))`,
        staleConversationIds,
      );
      // executions.conversation_id has no FK cascade — delete explicitly
      await this.db.exec(
        `DELETE FROM executions WHERE conversation_id IN (${placeholders})`,
        staleConversationIds,
      );
      await this.db.exec(`DELETE FROM conversations WHERE id IN (${placeholders})`, staleConversationIds);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.runNow();
    void this._loop();
  }

  stop(): void {
    this.running = false;
    this._tick();
  }

  private _tick(): void {
    if (this.tickResolve) {
      const resolve = this.tickResolve;
      this.tickResolve = null;
      resolve();
    }
  }

  private async _loop(): Promise<void> {
    while (this.running) {
      await new Promise<void>((resolve) => {
        this.tickResolve = resolve;
        this.waitFn(60 * 60_000).then(() => {
          if (this.tickResolve === resolve) {
            this.tickResolve = null;
            resolve();
          }
        });
      });
      if (this.running) await this.runNow();
    }
  }
}
