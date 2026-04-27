# Spec: Pinia Store Boundaries

## Overview

Requirements for what belongs in each Pinia store, what belongs in components, and how stores communicate.

## Requirements

### R1 — No passthrough re-exports

A Pinia store MUST NOT re-export reactive state or functions from another store as computed aliases. Callers that need data from store A MUST import store A directly. Passthrough re-exports create double-computed hops, obscure ownership, and inflate store surface area.

### R2 — No embedded event buses

A Pinia store MUST NOT contain a `hooks` Map (or equivalent publish/subscribe mechanism) through which other stores register callbacks. Inter-store communication MUST be expressed as direct function calls from the top-level dispatcher (e.g., `App.vue`) or direct imports between stores.

### R3 — Component-local state stays in components

Reactive state that is only read and mutated within a single component (or its direct children via props) MUST be declared as component-local `ref`s, not stored in Pinia. Pinia is for state that must be shared across unrelated components or must survive component unmount.

Examples of state that belongs in components, not stores:
- Currently selected file in a review overlay
- Active filter in a review overlay
- Optimistic in-flight updates that are reset on every open

### R4 — Zero-state stores are not stores

A `defineStore` with no reactive state (only functions) MUST be converted to a plain ES module. Pinia stores carry overhead (devtools registration, SSR serialization, reactive wrapping) that is wasteful for stateless API wrappers.

### R6 — No passthrough computed aliases for cross-store state

A Pinia store SHALL NOT expose computed properties that are simple aliases to another store's state (e.g., `const messages = computed(() => otherStore.messages)`). Components that need state from multiple stores SHALL import those stores directly. This prevents double-computed hops and obscures true data ownership.

### R5 — Cleanup on entity deletion

When a task or conversation entity is deleted, all Pinia state keyed by that entity's ID MUST be cleaned up in the same operation:
- `changedFileCounts[taskId]` when a task is deleted
- `taskQueues[taskId]` when a task is deleted
- `streamStates.get(conversationId)` when a conversation is closed (blocks cleared per R1 in `frontend-reactive-stream`)
