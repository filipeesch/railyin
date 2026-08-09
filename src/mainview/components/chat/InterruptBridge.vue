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
import { useInterrupt } from "@copilotkit/vue/v2";
import { interruptBridgeState } from "./interruptBridge";

// Publish into the module-scoped holder; RailyinChat consumes it for the
// hasInterrupt input disable (the #interrupt slot's resolve/cancel come from
// CopilotChat's own slot props).
interruptBridgeState.value = useInterrupt();
</script>
