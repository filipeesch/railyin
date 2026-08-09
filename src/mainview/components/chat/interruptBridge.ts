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
