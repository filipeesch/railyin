import { readFileSync, existsSync } from "node:fs";

/**
 * Captures file content before a tool executes, enabling accurate per-call diffs.
 *
 * Lifecycle:
 * 1. `capture()` at tool_use time — reads current file content
 * 2. Tool executes (file is modified on disk)
 * 3. `get()` at tool_result time — returns captured before-content
 * 4. `delete()` after diff computation — releases the entry
 * 5. `clear()` at execution end — safety net for any remaining entries
 */
export interface FileStateCache {
  /**
   * Capture the current content of a file. Called at tool_use time.
   * If the file doesn't exist or read fails, stores `null` (non-fatal degradation).
   */
  capture(callId: string, worktreePath: string, filePath: string): void;

  /**
   * Retrieve the captured before-content for a callId.
   * Returns `string` (before-content), `null` (new file), or `undefined` (never captured).
   */
  get(callId: string): string | null | undefined;

  /**
   * Release a cache entry after diff computation.
   */
  delete(callId: string): void;

  /**
   * Clear all entries. Called at execution end as a safety net.
   */
  clear(): void;
}

/**
 * Default implementation that reads from disk via `readFileSync`.
 * Used by the Claude engine for real file diff computation.
 */
export class DefaultFileStateCache implements FileStateCache {
  private readonly store = new Map<string, string | null>();

  capture(callId: string, worktreePath: string, filePath: string): void {
    const absPath = worktreePath ? `${worktreePath}/${filePath}` : filePath;
    try {
      if (existsSync(absPath)) {
        this.store.set(callId, readFileSync(absPath, "utf-8"));
      } else {
        this.store.set(callId, null); // new file
      }
    } catch {
      // Read failure is non-fatal — treat as new file
      this.store.set(callId, null);
    }
  }

  get(callId: string): string | null | undefined {
    return this.store.get(callId);
  }

  delete(callId: string): void {
    this.store.delete(callId);
  }

  clear(): void {
    this.store.clear();
  }
}
