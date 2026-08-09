/**
 * interrupt-registry.ts — module-level per-thread pending-interrupt registry
 * (Phase 3, D-04/D-05). Lives at MODULE level, NOT on the agent: the runtime
 * clones the agent per request (cloneAgentForRequest, Pitfall 4) and instance
 * fields would be lost. Precedent: the runtime's own ɵGLOBAL_STORE.
 *
 * Id scheme: `decision-${conversationId}-${seq}` with a per-thread seq counter
 * (A3) — NEVER derived from executionId, which is still null at terminal time
 * during synchronous fake dispatch (Pitfall 3).
 *
 * Lifecycle: register() at the interrupt terminal; updateExecutionId() once
 * the execution resolves; clear() on resume/cancel (03-02); reset() between
 * tests (Pattern 6). clear() removes the entry but KEEPS the per-thread seq so
 * consecutive decision batches on one thread mint -1, -2, … (pinned by the
 * registry-lifecycle test).
 *
 * Restart resilience (03-03 Task 2, A2/Open Question 1 — rebuild, not reject):
 * the composition root injects the durable JSONL store via configure(); on a
 * FRESH process the registry is empty, so ensureOpen() lazily rebuilds a
 * pending interrupt from the thread's JSONL tail (the last RUN_FINISHED with
 * outcome.type "interrupt") + the `waiting_user` executions row — restoring
 * the SAME persisted interruptId (never a new id — the client resumes the
 * persisted one, T-03-15), the metadata payload, the correlated executionId,
 * and the per-thread seq counter. Old-stack parity: a decision paused before
 * a restart remains answerable.
 */
import type { BaseEvent } from "@ag-ui/client";
import type { Database } from "bun:sqlite";
import type { JsonlStore } from "./jsonl-store.ts";

export interface PendingInterrupt {
  interruptId: string;
  conversationId: number;
  executionId: number | null;
  payload: string;
  createdAt: number;
}

const pending = new Map<string, PendingInterrupt>();
const seqByThread = new Map<string, number>();
let store: JsonlStore | null = null;

/**
 * Composition-root injection (03-03 Task 2): called ONCE with the durable
 * JSONL store; inert until set (ensureOpen returns null with no store — the
 * reject-only fallback). The probe path never calls this — probe threadIds
 * like "t1" are non-numeric and must never reach the store's validation.
 */
export function configure(options: { store?: JsonlStore }): void {
  store = options.store ?? null;
}

/**
 * Cold-path fallback (A2): returns the existing entry, else lazily rebuilds
 * from the thread's JSONL tail. Scans BACKWARDS for the LAST RUN_FINISHED
 * with `outcome.type === "interrupt"`, restores the persisted interruptId
 * verbatim (T-03-15), round-trips the interrupt metadata into the payload
 * (the bridge's buildInterruptOutcome parse source), bumps the per-thread seq
 * counter to `max(counter, trailingSeq)` for id continuity, and correlates the
 * durable `waiting_user` executions row for the executionId.
 *
 * Returns null when nothing is rebuildable — no store, no log, or no
 * interrupt terminal — so the resume rejects cleanly with INVALID_INTERRUPT
 * (T-03-12), never a crash or a 500. Reads ONLY via the store's validated
 * read() (assertThreadId containment — T-03-14).
 */
export function ensureOpen(threadId: string, db: Database): PendingInterrupt | null {
  const existing = pending.get(threadId);
  if (existing) return existing;
  if (!store) return null;
  const events = store.read(threadId);
  if (!events) return null;

  // Backwards scan: the LAST interrupt terminal in the log (a later resume
  // run on the thread must not shadow it — Replay B + Rebuild C2).
  let terminal: BaseEvent | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as BaseEvent & { outcome?: { type?: string; interrupts?: { id?: string; metadata?: unknown }[] } };
    if (e.type === "RUN_FINISHED" && e.outcome?.type === "interrupt") {
      terminal = e;
      break;
    }
  }
  if (!terminal) return null;
  const outcome = terminal.outcome as unknown as { interrupts?: { id?: string; metadata?: unknown }[] };
  const interrupts = outcome.interrupts;
  if (!interrupts?.length) return null;
  const interruptId = interrupts[0].id;
  if (!interruptId) return null;

  // Payload = the persisted metadata (the buildInterruptOutcome parse source).
  const metadata = interrupts[0].metadata;
  const payload = metadata != null ? JSON.stringify(metadata) : "";

  // Seq continuity: decision-<conv>-<seq> → bump the thread counter past seq.
  const seqMatch = /-(\d+)$/.exec(interruptId);
  const seq = seqMatch ? Number(seqMatch[1]) : 0;
  seqByThread.set(threadId, Math.max(seqByThread.get(threadId) ?? 0, seq));

  // Correlate the durable waiting_user executions row for the executionId.
  const row = db
    .query<{ id: number }, [number]>(
      "SELECT id FROM executions WHERE conversation_id = ? AND status = 'waiting_user' LIMIT 1",
    )
    .get(Number(threadId));

  const entry: PendingInterrupt = {
    interruptId,
    conversationId: Number(threadId),
    executionId: row?.id ?? null,
    payload,
    createdAt: Date.now(),
  };
  pending.set(threadId, entry);
  return entry;
}

/**
 * Mint `decision-${conversationId}-${seq}` (per-thread seq), store the entry
 * with executionId null, return the id. The entry payload is the raw
 * serialized DecisionRequestPayload string — parsing stays in the bridge
 * helper (buildInterruptOutcome).
 */
export function register(conversationId: number, payload: string): string {
  const threadId = String(conversationId);
  const seq = (seqByThread.get(threadId) ?? 0) + 1;
  seqByThread.set(threadId, seq);
  const interruptId = `decision-${conversationId}-${seq}`;
  pending.set(threadId, {
    interruptId,
    conversationId,
    executionId: null,
    payload,
    createdAt: Date.now(),
  });
  return interruptId;
}

export function get(threadId: string): PendingInterrupt | undefined {
  return pending.get(threadId);
}

export function hasOpen(threadId: string): boolean {
  return pending.has(threadId);
}

export function clear(threadId: string): void {
  pending.delete(threadId);
}

/** Attach the resolved executionId to an existing entry; no-op when none. */
export function updateExecutionId(threadId: string, executionId: number): void {
  const entry = pending.get(threadId);
  if (entry) entry.executionId = executionId;
}

/** Test hook (Pattern 6) — empties ALL threads, including seq counters. */
export function reset(): void {
  pending.clear();
  seqByThread.clear();
}
