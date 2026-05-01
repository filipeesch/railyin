# Spec: UI Stream Reactivity Tests

## Overview

Test requirements for verifying the frontend stream reactivity performance fixes — covering Map identity preservation, stream state lifecycle, rendering isolation, and auto-scroll behavior.

## Requirements

### R1 — Stream block Map identity is preserved on mutation

The `streamStates` Map in `conversation.ts` SHALL NOT be replaced with a new Map instance when a stream event is processed. Vue 3 tracks `Map.set()` per-key natively and no clone is required.

Tests MUST verify that `store.streamStates` (the reactive ref) is the same Map instance before and after any stream event call.

### R2 — Stream state lifecycle on done

When a `done` event arrives for a non-active conversation, tests MUST verify:
- `blocks` Map is empty and `roots` array is empty
- `isDone` is `true`
- The state shell (with `executionId`) is retained in `streamStates`

When a `done` event arrives for the active conversation, tests MUST verify that `blocks` still contains all streamed blocks.

### R3 — Rendering isolation

A Playwright test MUST verify that when a drawer is open for task A and stream events arrive for task B, a `MutationObserver` on task A's `.conv-body` records zero mutations.

### R4 — Auto-scroll without streamVersion

A Playwright test MUST verify that the conversation body scrolls to the bottom when a new root block is added to the active conversation, without relying on a `streamVersion` prop.

### R5 — Unread marking for background conversations

A Playwright test MUST verify that task B's task card shows an unread indicator after background stream events arrive while task A's drawer is open.

### Requirement: False-failure path unlocks send button after done event
`e2e/ui/stream-reactivity.spec.ts` SHALL include E-X verifying that when a task transitions to `failed` execution state while still streaming, the send button becomes enabled and the streaming indicator is dismissed once a `done` stream event is received.

#### Scenario: E-X — send button re-enables after failed + done
- **WHEN** a task's execution state is updated to `failed` via `task.updated` push
- **AND** a `done` stream event is subsequently pushed for that execution
- **THEN** the streaming indicator is dismissed
- **AND** the send/submit button is enabled (not disabled)

### Requirement: Chat scroll position is stable during active token streaming
`e2e/ui/stream-reactivity.spec.ts` SHALL include E-Y verifying that the conversation body remains scrolled to the bottom throughout active streaming, checked across multiple mid-stream checkpoints, not only at the end.

#### Scenario: E-Y — scroll stays at bottom across mid-stream checkpoints
- **WHEN** tokens are pushed in three batches of five text_chunk events each
- **THEN** after each batch, `scrollTop + clientHeight >= scrollHeight - 40` is true
- **AND** no mid-stream checkpoint shows the viewport having left the bottom
