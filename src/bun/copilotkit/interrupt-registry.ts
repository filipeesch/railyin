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
 */
export interface PendingInterrupt {
  interruptId: string;
  conversationId: number;
  executionId: number | null;
  payload: string;
  createdAt: number;
}

const pending = new Map<string, PendingInterrupt>();
const seqByThread = new Map<string, number>();

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
