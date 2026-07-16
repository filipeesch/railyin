import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { getDataDir } from "../utils/platform.ts";
import { KeyedWriteQueue } from "../utils/write-queue.ts";
import type { RawMessageItem } from "../engine/stream/raw-message-buffer.ts";

/** Writes forensic raw-wire-protocol capture (previously `model_raw_messages` SQL rows) to a
 *  per-execution JSONL debug log file. Never read by running application code — for manual
 *  forensic inspection only (see `.claude/rules/investigate.md`). */
export interface RawMessageDebugLogWriter {
  append(items: RawMessageItem[]): Promise<void>;
}

const writeQueue = new KeyedWriteQueue();

/**
 * File-based `RawMessageDebugLogWriter`: appends JSON Lines to
 * `~/.railyn/conversations/<conversationId>.debug.<executionId>.jsonl`, colocated with the
 * conversation's message file so `ConversationFileDeleter` can find and remove all of a
 * conversation's files (message file, sidecar, debug logs) by `conversationId` alone.
 */
export class FileRawMessageDebugLogWriter implements RawMessageDebugLogWriter {
  constructor(private readonly baseDir: string = join(getDataDir(), "conversations")) {}

  async append(items: RawMessageItem[]): Promise<void> {
    if (items.length === 0) return;

    const byFile = new Map<string, RawMessageItem[]>();
    for (const item of items) {
      const key = `${item.conversationId}.debug.${item.executionId}`;
      const group = byFile.get(key);
      if (group) group.push(item);
      else byFile.set(key, [item]);
    }

    await Promise.all(
      Array.from(byFile.entries()).map(([key, group]) =>
        writeQueue.enqueue(key, async () => {
          const path = join(this.baseDir, `${key}.jsonl`);
          await fs.mkdir(dirname(path), { recursive: true });
          const text = `${group
            .map((item) =>
              JSON.stringify({
                taskId: item.taskId,
                engine: item.raw.engine,
                sessionId: item.raw.sessionId ?? null,
                streamSeq: item.seq,
                direction: item.raw.direction,
                eventType: item.raw.eventType,
                eventSubtype: item.raw.eventSubtype ?? null,
                payload: item.raw.payload,
                createdAt: new Date().toISOString(),
              }),
            )
            .join("\n")}\n`;
          await fs.appendFile(path, text, "utf-8");
        }),
      ),
    );
  }
}

/** Deletes debug-log files (the `model_raw_messages` file-based replacement) under `baseDir`
 *  whose mtime is older than `maxAgeMs`. Mirrors the previous age-based SQL retention (1 day). */
export async function pruneDebugLogFiles(baseDir: string, maxAgeMs: number): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(baseDir);
  } catch {
    return; // Directory doesn't exist yet — nothing to prune.
  }
  const cutoff = Date.now() - maxAgeMs;
  await Promise.all(
    entries
      .filter((name) => /\.debug\.\d+\.jsonl$/.test(name))
      .map(async (name) => {
        const path = join(baseDir, name);
        try {
          const stat = await fs.stat(path);
          if (stat.mtimeMs < cutoff) {
            await fs.rm(path, { force: true });
          }
        } catch {
          // File vanished/inaccessible between readdir and stat — ignore.
        }
      }),
  );
}

