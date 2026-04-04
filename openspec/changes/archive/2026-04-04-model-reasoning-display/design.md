## Context

The engine uses a unified streaming loop where `stream()` yields `StreamEvent`s. Currently there are three event types: `token`, `tool_calls`, `done`. When Qwen3 (and similar models) think before responding, they emit `delta.reasoning_content` rather than `delta.content` — our provider ignores this field entirely. The result: `fullResponse` stays empty, the engine thinks the model is dead, burns the nudge budget, and eventually fails or produces no visible output for the user.

The conversation is an append-only DB log with typed messages. Message types are free-text strings in the `type` column.

The task detail drawer renders messages from the DB as a timeline, dispatching on `type` to pick a component. New types drop in cleanly.

## Goals / Non-Goals

**Goals:**
- Surface reasoning tokens in the UI as collapsible bubbles (one per model round)
- Persist reasoning to the DB so it's visible after page reload
- Fix the nudge budget so reasoning rounds are not counted as empty/dead responses
- Keep `ReasoningBubble` visually consistent with the existing tool call card pattern

**Non-Goals:**
- Sending reasoning back to the model in subsequent rounds (reasoning is for the user only)
- Configuring which models produce reasoning (provider-agnostic: if `delta.reasoning_content` appears, we surface it)
- Streaming reasoning tokens live to the frontend (we stream them live via a push event but don't need a new IPC channel — reuse `onStreamToken` with a flag)

## Decisions

### D1 — Reuse `onStreamToken` with an `isReasoning` flag (vs. a new IPC channel)

We add `isReasoning?: boolean` to the `StreamTokenPayload` in `rpc-types.ts`. The same Bun→frontend push event carries both token types. The frontend store inspects the flag to route into the current reasoning accumulator vs. the normal streaming bubble.

**Alternative considered:** A separate `onReasoningToken` IPC event. Rejected — doubles the IPC surface for minimal benefit; `isReasoning` flag is simpler and backward-compatible (old frontends ignore the flag).

### D2 — Accumulate reasoning per round; persist once at round end (vs. streaming to DB)

Reasoning tokens are accumulated in-memory in the engine during the round. When the round ends (tool calls received, or final response starts), the accumulated text is written once as a single `reasoning` DB message — positioned immediately before the tool_call or assistant message it preceded.

**Alternative considered:** Append each token to DB. Rejected — high write pressure, no benefit since the UI already streams token-by-token via the IPC push.

### D3 — One `reasoning` DB message type per round (vs. embedding in `assistant`)

A distinct `reasoning` message type in the DB allows the drawer to dispatch to `ReasoningBubble.vue` cleanly, without special-casing inside the assistant message renderer.

**Alternative considered:** Store as a special `assistant` sub-type with a metadata flag. Rejected — muddies the conversation spec and complicates `compactMessages` (which must exclude reasoning from the LLM context).

### D4 — Reasoning excluded from `compactMessages` (not sent back to model)

`compactMessages` already excludes `system`, `transition_event`, `ask_user_prompt`, `file_diff`. `reasoning` joins this exclusion list. The model's own thinking tokens should not be re-injected into the context.

### D5 — `ReasoningBubble` mirrors tool call card UX (vs. custom design)

Reuses the same collapsible card structure as tool calls: header with icon + label, chevron toggle, scrollable body. While streaming: pulsing animation, header "Thinking…", body expanded. On round end: static checkmark, header "Thought for Xs", body auto-collapses.

The bubble is keyed by a transient `reasoningRoundId` (per-round counter, not a DB id) that the frontend store manages. On reload, reasoning messages from DB render collapsed (streaming state is gone).

### D6 — Nudge budget: skip increment when `hadReasoning` flag is set

The engine tracks a boolean `hadReasoning` per round, set to `true` whenever a `reasoning` event is forwarded. At the empty-response check, if `hadReasoning` is true, we reset it and do NOT increment `emptyResponseNudges`. The model was working — just not yet done.

## Risks / Trade-offs

- **Models that produce reasoning but no final content** (pathological case) → after `MAX_NUDGES` rounds with only reasoning and no output, the existing failure path kicks in with the "model produced no output" error message. `hadReasoning` reset prevents premature failure but doesn't loop forever.
- **Reasoning tokens in old messages on reload** → messages saved as `type: "reasoning"` render as collapsed `ReasoningBubble`s in the drawer. No duration shown (elapsed time is ephemeral). Acceptable.
- **`enable_thinking: false` in the request body** → LM Studio may honour this and suppress reasoning entirely, in which case `delta.reasoning_content` never appears and the feature is dormant. No behaviour change for models that don't reason. Good.

## Migration Plan

No DB schema migration needed — `type` is free-text. No data migration. Deployed by restarting the app after updating the code. Rollback: revert the code; any existing `reasoning` rows in the DB are ignored (the drawer falls back to a plain text render for unknown types).
