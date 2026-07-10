import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./helpers.ts";
import { FsConversationFileDeleter } from "../conversation/conversation-file-deleter.ts";

/**
 * `FsConversationFileDeleter` is a standalone collaborator (decision D10) that removes a
 * conversation's on-disk files: its JSONL message file, `.meta.json` sidecar, and any
 * per-execution raw-message debug logs. Deletion is unconditional — for a legacy
 * (SQLite-backed) conversation, none of these files exist, so the removal attempts are
 * harmless no-ops (asserted below without needing a real Database dependency).
 */
describe("FsConversationFileDeleter", () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const created = makeTempDir();
    dir = created.dir;
    cleanup = created.cleanup;
  });

  afterEach(() => cleanup());

  async function exists(path: string): Promise<boolean> {
    try {
      await fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  it("deletes the .jsonl and .meta.json files for a file-backed conversation", async () => {
    const conversationId = 42;
    const jsonlPath = join(dir, `${conversationId}.jsonl`);
    const metaPath = join(dir, `${conversationId}.meta.json`);
    await fs.writeFile(jsonlPath, '{"content":"hi"}\n', "utf-8");
    await fs.writeFile(metaPath, "{}", "utf-8");

    const deleter = new FsConversationFileDeleter(dir);
    await deleter.deleteConversationFiles(conversationId);

    expect(await exists(jsonlPath)).toBe(false);
    expect(await exists(metaPath)).toBe(false);
  });

  it("deletes all per-execution debug-log files for the conversation", async () => {
    const conversationId = 42;
    const debugLog1 = join(dir, `${conversationId}.debug.100.jsonl`);
    const debugLog2 = join(dir, `${conversationId}.debug.101.jsonl`);
    await fs.writeFile(debugLog1, "{}\n", "utf-8");
    await fs.writeFile(debugLog2, "{}\n", "utf-8");

    const deleter = new FsConversationFileDeleter(dir);
    await deleter.deleteConversationFiles(conversationId);

    expect(await exists(debugLog1)).toBe(false);
    expect(await exists(debugLog2)).toBe(false);
  });

  it("does not touch another conversation's files (debug logs or message files)", async () => {
    const targetId = 42;
    const otherId = 43;
    const otherJsonl = join(dir, `${otherId}.jsonl`);
    const otherMeta = join(dir, `${otherId}.meta.json`);
    const otherDebugLog = join(dir, `${otherId}.debug.100.jsonl`);
    await fs.writeFile(otherJsonl, '{"content":"keep-me"}\n', "utf-8");
    await fs.writeFile(otherMeta, "{}", "utf-8");
    await fs.writeFile(otherDebugLog, "{}\n", "utf-8");

    const deleter = new FsConversationFileDeleter(dir);
    await deleter.deleteConversationFiles(targetId);

    expect(await exists(otherJsonl)).toBe(true);
    expect(await exists(otherMeta)).toBe(true);
    expect(await exists(otherDebugLog)).toBe(true);
  });

  it("no-ops for a legacy (SQLite-backed) conversation whose files were never created", async () => {
    const deleter = new FsConversationFileDeleter(dir);
    // Should resolve cleanly without throwing, even though nothing exists on disk.
    await expect(deleter.deleteConversationFiles(999)).resolves.toBeUndefined();
  });

  it("no-ops cleanly when the base directory itself doesn't exist yet", async () => {
    const deleter = new FsConversationFileDeleter(join(dir, "does-not-exist"));
    await expect(deleter.deleteConversationFiles(1)).resolves.toBeUndefined();
  });
});
