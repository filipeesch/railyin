<template>
  <!-- Invisible: exists only to run useInterrupt INSIDE CopilotChat's render
       tree. CopilotChat wraps its slots in CopilotChatConfigurationProvider
       (agent-id/thread-id props, verified in the installed bundle), so a hook
       called here resolves the per-thread agent clone and observes the run
       events that carry interrupt outcomes. Called from RailyinChat's own
       setup (outside that tree) the hook falls back to the registry agent,
       which never sees thread run events — the decision card would never
       render (05-04 Rule 1 fix). -->
  <span class="railyn-chat__interrupt-bridge" aria-hidden="true" />
</template>

<script setup lang="ts">
import { onUnmounted } from "vue";
import { useInterrupt } from "@copilotkit/vue/v2";
import { interruptBridgeState, getRecordedInterruptOutcome } from "./interruptBridge";

// WR-01 (D-08): the SDK sets the slot's `result` ONLY from a custom handler
// return value — and the handler runs when an interrupt appears, so it cannot
// distinguish a fresh interrupt from a replayed one. Return the recorded
// outcome for interrupts the user already answered in this SPA session (the
// thread-reopen replay shows the collapsed "Decision recorded" summary); any
// other interrupt returns null so the interactive card renders.
const myState = useInterrupt({
  handler: ({ interrupt }) => {
    if (!interrupt) return null;
    const outcome = getRecordedInterruptOutcome(interrupt.id);
    if (!outcome) return null;
    return { status: outcome.status, payload: outcome.payload ?? interrupt.metadata };
  },
});

// Publish into the module-scoped holder; RailyinChat consumes it for the
// hasInterrupt input disable (the #interrupt slot's resolve/cancel come from
// CopilotChat's own slot props).
interruptBridgeState.value = myState;

// IN-05: clear the module holder on unmount so a later mount never reads a
// stale hook from the previous chat (one-frame wrongly-disabled input flash
// when the previous thread had a pending interrupt).
onUnmounted(() => {
  if (interruptBridgeState.value === myState) interruptBridgeState.value = null;
});
</script>
