import type { Database } from "bun:sqlite";
import type { WaitFn } from "../pipeline/write-buffer.ts";

const defaultWaitFn: WaitFn = (ms) => new Promise((r) => setTimeout(r, ms));

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
    this.db.run("DELETE FROM model_raw_messages WHERE created_at < datetime('now', '-1 day')");
    this.db.run("DELETE FROM stream_events WHERE created_at < datetime('now', '-4 hours')");
    // Collect conversation IDs owned by expired archived chat sessions, then delete
    // the chat sessions first (to free the FK reference), then delete the conversations
    // so that ON DELETE CASCADE propagates to conversation_messages and stream_events.
    const staleConversationIds = this.db
      .query<{ conversation_id: number }, []>(
        `SELECT conversation_id FROM chat_sessions
         WHERE status = 'archived' AND archived_at < datetime('now', '-7 days')`,
      )
      .all()
      .map((r) => r.conversation_id);

    this.db.run(
      "DELETE FROM chat_sessions WHERE status = 'archived' AND archived_at < datetime('now', '-7 days')"
    );

    if (staleConversationIds.length > 0) {
      const placeholders = staleConversationIds.map(() => "?").join(", ");
      this.db.run(`DELETE FROM conversations WHERE id IN (${placeholders})`, staleConversationIds);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.runNow();
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
        this.waitFn(5 * 60_000).then(() => {
          if (this.tickResolve === resolve) {
            this.tickResolve = null;
            resolve();
          }
        });
      });
      if (this.running) this.runNow();
    }
  }
}
