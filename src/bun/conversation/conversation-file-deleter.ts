import { promises as fs } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "../utils/platform.ts";

/**
 * Deletes all on-disk files belonging to a conversation: its JSONL message file, `.meta.json`
 * sidecar, and any per-execution raw-message debug logs. A standalone collaborator (not a
 * method on `ConversationMessageStore`, per decision D10) so the store stays focused on
 * read/write of message content, and each of the three call sites (`tasks.delete`,
 * `BoardToolExecutor.execDeleteTask`, `RetentionJob.runNow`) gets a small, independently
 * mockable dependency.
 *
 * Deletion is unconditional and idempotent — it never inspects `storage_medium` first. For a
 * legacy (SQLite-backed) conversation no matching files exist, so the removal attempts are
 * harmless no-ops; this keeps the deleter decoupled from the database entirely.
 */
export interface ConversationFileDeleter {
  deleteConversationFiles(conversationId: number): Promise<void>;
}

export class FsConversationFileDeleter implements ConversationFileDeleter {
  constructor(private readonly baseDir: string = join(getDataDir(), "conversations")) {}

  async deleteConversationFiles(conversationId: number): Promise<void> {
    const removals: Promise<void>[] = [
      fs.rm(join(this.baseDir, `${conversationId}.jsonl`), { force: true }),
      fs.rm(join(this.baseDir, `${conversationId}.meta.json`), { force: true }),
    ];

    let entries: string[];
    try {
      entries = await fs.readdir(this.baseDir);
    } catch {
      entries = []; // Directory doesn't exist — nothing more to remove.
    }
    const debugLogPrefix = `${conversationId}.debug.`;
    for (const name of entries) {
      if (name.startsWith(debugLogPrefix) && name.endsWith(".jsonl")) {
        removals.push(fs.rm(join(this.baseDir, name), { force: true }));
      }
    }

    await Promise.all(removals);
  }
}
