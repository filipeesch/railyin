/**
 * interruptBridge.ts — reactive handoff for the #interrupt wiring (05-04
 * Task 2). InterruptBridge.vue (rendered inside CopilotChat's #input slot)
 * runs useInterrupt within CopilotChat's configuration-provider tree — the
 * only place the hook resolves the per-thread agent clone and observes run
 * events carrying interrupt outcomes. RailyinChat reads the published state
 * here for the hasInterrupt input disable.
 *
 * The holder is a Ref so replacing it when the bridge mounts (child setup
 * runs during CopilotChat's render, after RailyinChat's first render)
 * triggers re-evaluation of consumers.
 *
 * Single-chat limitation (module singleton): the task drawer mounts one
 * RailyinChat; SessionChatView's swap (05-05) keeps one chat visible at a
 * time, so the last-mounted bridge winning is acceptable for v1.
 */
import { ref, type ComputedRef } from "vue";
import type { RunAgentResult } from "@ag-ui/client";

export interface InterruptBridgeState {
  hasInterrupt: ComputedRef<boolean>;
  resolve: (payload?: unknown, interruptId?: string) => Promise<RunAgentResult | void>;
  cancel: (interruptId?: string) => Promise<RunAgentResult | void>;
}

/** Written by the bridge (inside the provider tree); read by RailyinChat. */
export const interruptBridgeState = ref<InterruptBridgeState | null>(null);

// ─── Recorded interrupt outcomes (WR-01, D-08 replay) ─────────────────────────
// The SDK only populates the #interrupt slot's `result` from a custom
// useInterrupt `handler` return value — and the handler runs the moment an
// interrupt appears, so it cannot tell a fresh interrupt from a replayed
// (already-answered) one. RailyinChat records the outcome here when the user
// submits/cancels; the bridge's handler replays it as the collapsed
// "Decision recorded" summary on thread reopen (D-08). Session-scoped: a full
// page reload clears the registry, so a reopened thread then shows the
// pending card again (documented WR-01 trade-off).
export interface RecordedInterruptOutcome {
  status: "resolved" | "cancelled";
  payload?: unknown;
  answeredAt: string;
}

const recordedOutcomes = new Map<string, RecordedInterruptOutcome>();

export function recordInterruptOutcome(
  interruptId: string,
  status: "resolved" | "cancelled",
  payload?: unknown,
): void {
  recordedOutcomes.set(interruptId, { status, payload, answeredAt: new Date().toISOString() });
}

export function getRecordedInterruptOutcome(interruptId: string): RecordedInterruptOutcome | undefined {
  return recordedOutcomes.get(interruptId);
}
