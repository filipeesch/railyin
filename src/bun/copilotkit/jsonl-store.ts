/**
 * jsonl-store.ts — append-only per-thread JSONL persistence (D-05, RUNR-02).
 *
 * One BaseEvent per line at `<dataDir>/threads/{threadId}.jsonl`, appended
 * per event (never run-end batched — replay needs the mid-run tail for
 * reconnect, Pitfall 7). The store is a pure-ish file module with no
 * constructor-visible deps: the composition root injects the data dir
 * (from `getDataDir()`).
 *
 * ThreadId sanitization is the SECOND defense line (the agent's `/^\d+$/`
 * validation from 02-01 is the first): every public method validates the id
 * and containment-checks the resolved path BEFORE any filesystem use
 * (security V5/V8, T-02-07).
 *
 * Phase 4 scope: crash tolerance + index rebuild from the log — `list()`
 * scans the threads dir (THREAD_ID_RE-filtered) so the log IS the index
 * (D-04/D-05); decoy entries are skipped, never thrown at. `importLog()`
 * writes whole imported logs atomically (tmp+rename) so file existence
 * stays the honest D-07 idempotency marker (Pitfall 5).
 */
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import type { BaseEvent } from "@ag-ui/client";

/** conversations.id is INTEGER AUTOINCREMENT — threadIds are decimal strings. */
const THREAD_ID_RE = /^\d+$/;

/** `join(dataDir, "threads", `${threadId}.jsonl`)` — the per-thread log path. */
export function threadLogPath(dataDir: string, threadId: string): string {
  return join(dataDir, "threads", `${threadId}.jsonl`);
}

/**
 * Thrown by importLog() when the final log file already exists (WR-02): a
 * concurrent writer (live-runner append or another import) created the
 * thread between the caller's existence check and the atomic publish.
 * Callers treat this as "skipped" (the D-07 marker now exists), never as
 * "failed" — the imported snapshot must not clobber live-appended events.
 */
export class ThreadLogExistsError extends Error {
  constructor(threadId: string) {
    super(`Thread ${threadId} log already exists — refusing to overwrite`);
    this.name = "ThreadLogExistsError";
  }
}

export class JsonlStore {
  constructor(private readonly dataDir: string) {}

  /**
   * Security V5/V8: reject non-numeric ids AND any resolved path that escapes
   * the threads dir — before any filesystem use. resolve() once per call;
   * never interpolate an unvalidated id into a path first.
   */
  private assertThreadId(threadId: string): void {
    if (!THREAD_ID_RE.test(threadId)) {
      throw new Error(`Invalid threadId: ${threadId}`);
    }
    const threadsDir = resolve(join(this.dataDir, "threads"));
    const resolved = resolve(threadLogPath(this.dataDir, threadId));
    if (!resolved.startsWith(threadsDir + sep)) {
      throw new Error(`Invalid threadId: ${threadId}`);
    }
  }

  /** Append ONE event as a JSON line, verbatim (per-event append — Pitfall 7). */
  append(threadId: string, event: BaseEvent): void {
    this.assertThreadId(threadId);
    const filePath = threadLogPath(this.dataDir, threadId);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(filePath, JSON.stringify(event) + "\n", "utf-8");
  }

  /**
   * Tolerant read: returns null when the file is absent; malformed/partial
   * lines are skipped + logged instead of failing the whole file (Pitfall 7;
   * Phase 4 hardens).
   */
  read(threadId: string): BaseEvent[] | null {
    this.assertThreadId(threadId);
    const filePath = threadLogPath(this.dataDir, threadId);
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const events: BaseEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as BaseEvent);
      } catch {
        console.warn(`[jsonl-store] Skipping malformed line in ${filePath}`);
      }
    }
    return events;
  }

  exists(threadId: string): boolean {
    this.assertThreadId(threadId);
    return existsSync(threadLogPath(this.dataDir, threadId));
  }

  /**
   * Atomic whole-file import write (Pattern 2, D-07): the complete event
   * array (source: SQLite, not a stream) is written to `{threadId}.jsonl.tmp`
   * and published to the final path WITHOUT clobbering (WR-02). A crashed
   * import leaves only a `.tmp` that `list()`/`exists()` never match, so the
   * final file's existence stays the trustworthy idempotency marker
   * (Pitfall 5 — a partial append would make existence checks lie). This is
   * the ONLY writer of imported logs; append() remains the live-run writer.
   */
  importLog(threadId: string, events: BaseEvent[]): void {
    this.assertThreadId(threadId);
    const filePath = threadLogPath(this.dataDir, threadId);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmpPath = filePath + ".tmp";
    writeFileSync(tmpPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    try {
      // Publish atomically WITHOUT overwriting: linkSync is one syscall that
      // fails with EEXIST when the final file already exists. The old
      // renameSync replaced the destination unconditionally — a thread file
      // created concurrently (live-runner append, double invocation) between
      // the caller's exists() check and this publish would have been
      // clobbered wholesale, losing every live-appended event (WR-02).
      linkSync(tmpPath, filePath);
    } catch (err) {
      unlinkSync(tmpPath); // never leave the .tmp behind on a refused publish
      if ((err as ErrnoException).code === "EEXIST") {
        throw new ThreadLogExistsError(threadId);
      }
      throw err;
    }
    unlinkSync(tmpPath);
  }

  /**
   * Index rebuild from the log (D-04/D-05): scan the threads dir, filter
   * entries through THREAD_ID_RE BEFORE any path use (V8 gate — a raw
   * filename is never interpolated into a path), and return the thread set
   * sorted by mtime descending. Non-conforming files (`{id}.jsonl.tmp`,
   * `{id}.meta.json`, non-numeric names) are SKIPPED, never thrown at; a
   * missing threads dir yields []; per-entry stat failures are tolerated so
   * one broken file cannot 500 the whole listing (T-04-04).
   */
  list(): Array<{ threadId: string; mtimeMs: number; birthtimeMs: number; size: number }> {
    const dir = join(this.dataDir, "threads");
    if (!existsSync(dir)) return [];
    const entries: Array<{ threadId: string; mtimeMs: number; birthtimeMs: number; size: number }> = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const threadId = name.slice(0, -6);
      if (!THREAD_ID_RE.test(threadId)) continue;
      try {
        const st = statSync(join(dir, name));
        entries.push({ threadId, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs, size: st.size });
      } catch {
        console.warn(`[jsonl-store] Skipping unreadable entry ${name} in ${dir}`);
      }
    }
    return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  /**
   * Reserved bookkeeping hook for crash-tolerance metadata (Phase 4). Phase 2
   * persists no payload — the terminal event in the log IS the run-end marker.
   */
  endRun(threadId: string): void {
    this.assertThreadId(threadId);
  }
}
