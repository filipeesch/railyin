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
 * RED stub: register() is unimplemented — the decision-cycle tests drive the
 * behavior. Real implementation lands in the GREEN commit.
 */
export interface PendingInterrupt {
  interruptId: string;
  conversationId: number;
  executionId: number | null;
  payload: string;
  createdAt: number;
}

/** Mint `decision-${conversationId}-${seq}` (per-thread seq), store the entry
 * with executionId null, return the id. */
export function register(conversationId: number, payload: string): string {
  throw new Error("interrupt-registry: register not implemented (RED)");
}

export function get(threadId: string): PendingInterrupt | undefined {
  return undefined;
}

export function hasOpen(threadId: string): boolean {
  return false;
}

export function clear(threadId: string): void {}

/** No-op when no entry exists. */
export function updateExecutionId(threadId: string, executionId: number): void {}

/** Test hook (Pattern 6) — empties ALL threads, including seq counters. */
export function reset(): void {}
