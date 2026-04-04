## Why

When a model like Qwen3 enters thinking/reasoning mode it emits `reasoning_content` tokens over the stream but no `content` tokens. The engine currently ignores this signal, treats the round as an empty (dead) response, and burns the nudge budget — eventually failing or producing no output. Users also have no visibility into whether the model is actively working or truly stuck. Surfacing reasoning gives users the same confidence they get from Copilot/Cursor, and fixing the nudge accounting prevents false failures.

## What Changes

- **New `reasoning` stream event** added to the `StreamEvent` union so providers can signal reasoning tokens distinctly from text tokens.
- **New `reasoning` DB message type** appended to the conversation when a reasoning round completes (persisted, survives reload).
- **Nudge budget no longer burned** when reasoning tokens were seen in the current round — a thinking model is not a dead model.
- **New `ReasoningBubble.vue` component** in the task detail drawer: collapsible card, expanded + animated (pulsing header "Thinking…") while streaming, auto-collapses to "Thought for Xs ✓" when the round ends. One bubble per tool round.

## Capabilities

### New Capabilities
- `model-reasoning`: Reasoning token streaming, DB persistence as a new message type, and the collapsible `ReasoningBubble` UI component rendered in the task detail drawer.

### Modified Capabilities
- `unified-ai-stream`: Add `{ type: "reasoning"; content: string }` to the `StreamEvent` union. Providers that detect `delta.reasoning_content` SHALL yield this event; providers that don't (e.g. FakeAI) simply never emit it.
- `conversation`: Add `reasoning` to the set of supported message types. A `reasoning` message stores the accumulated reasoning text for one model round and is appended once the round ends.
- `task-detail`: Render `reasoning` messages as `ReasoningBubble` components interleaved in the conversation timeline at the position they were recorded.

## Impact

- `src/bun/ai/types.ts` — `StreamEvent` union gains `reasoning` variant
- `src/bun/ai/openai-compatible.ts` — detect `delta.reasoning_content`, yield `reasoning` events
- `src/bun/ai/fake.ts` — no change required (reasoning events are optional)
- `src/bun/workflow/engine.ts` — accumulate reasoning per round, skip nudge increment when reasoning seen, append `reasoning` DB message at round end
- `src/shared/rpc-types.ts` — add `reasoning` to `MessageType`; add `onReasoningToken` RPC push event
- `src/bun/db/migrations.ts` — no schema change needed (`type` column is free-text)
- `src/mainview/stores/task.ts` — handle `onReasoningToken` push, accumulate per-round transient state
- `src/mainview/components/ReasoningBubble.vue` — new component
- `src/mainview/components/MessageBubble.vue` or `TaskDetailDrawer.vue` — render reasoning bubbles
