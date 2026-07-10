import type { Database } from "bun:sqlite";
import { join } from "node:path";
import type { WaitFn } from "../pipeline/write-buffer.ts";
import { getDataDir } from "../utils/platform.ts";
import { pruneDebugLogFiles } from "../conversation/raw-message-debug-log.ts";
import type { ConversationFileDeleter } from "../conversation/conversation-file-deleter.ts";
import { FsConversationFileDeleter } from "../conversation/conversation-file-deleter.ts";

const defaultWaitFn: WaitFn = (ms) => new Promise((r) => setTimeout(r, ms));

const DEBUG_LOG_MAX_AGE_MS = 24 * 60 * 60_000; // 1 day — matches previous model_raw_messages retention

export class RetentionJob {
  private running = false;
  private tickResolve: (() => void) | null = null;
  private readonly waitFn: WaitFn;
  private readonly debugLogBaseDir: string;
  private readonly conversationFileDeleter: ConversationFileDeleter;

  constructor(
    private readonly db: Database,
    waitFn?: WaitFn,
    debugLogBaseDir?: string,
    conversationFileDeleter?: ConversationFileDeleter,
  ) {
    this.waitFn = waitFn ?? defaultWaitFn;
    this.debugLogBaseDir = debugLogBaseDir ?? join(getDataDir(), "conversations");
    this.conversationFileDeleter = conversationFileDeleter ?? new FsConversationFileDeleter();
  }

  async runNow(): Promise<void> {
    await pruneDebugLogFiles(this.debugLogBaseDir, DEBUG_LOG_MAX_AGE_MS);
    // Collect conversation IDs owned by expired archived chat sessions, then delete
    // the chat sessions first (to free the FK reference), then clean up executions
    // (no FK cascade in production — must be explicit), then delete the conversations
    // so that ON DELETE CASCADE propagates to conversation_messages.
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
      // Delete task_execution_checkpoints before executions (no ON DELETE CASCADE on execution_id)
      this.db.run(
        `DELETE FROM task_execution_checkpoints WHERE execution_id IN (SELECT id FROM executions WHERE conversation_id IN (${placeholders}))`,
        staleConversationIds,
      );
      // executions.conversation_id has no FK cascade — delete explicitly
      this.db.run(
        `DELETE FROM executions WHERE conversation_id IN (${placeholders})`,
        staleConversationIds,
      );
      this.db.run(`DELETE FROM conversations WHERE id IN (${placeholders})`, staleConversationIds);
      await Promise.all(
        staleConversationIds.map((id) =>
          this.conversationFileDeleter.deleteConversationFiles(id).catch(() => { }),
        ),
      );
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
