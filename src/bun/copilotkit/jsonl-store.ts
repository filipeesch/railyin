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
 * Phase 2 scope: basic append + tolerant read. Crash tolerance (buffered
 * writer, atomic index, event ids) is deliberately Phase 4 per CONTEXT.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import type { BaseEvent } from "@ag-ui/client";

/** conversations.id is INTEGER AUTOINCREMENT — threadIds are decimal strings. */
const THREAD_ID_RE = /^\d+$/;

/** `join(dataDir, "threads", `${threadId}.jsonl`)` — the per-thread log path. */
export function threadLogPath(dataDir: string, threadId: string): string {
  return join(dataDir, "threads", `${threadId}.jsonl`);
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
   * Reserved bookkeeping hook for crash-tolerance metadata (Phase 4). Phase 2
   * persists no payload — the terminal event in the log IS the run-end marker.
   */
  endRun(threadId: string): void {
    this.assertThreadId(threadId);
  }
}
