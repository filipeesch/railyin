## Why

Claude 4+ models introduced two new stop reasons — `refusal` and `model_context_window_exceeded` — that we don't detect. Both currently surface as empty text responses, triggering the nudge loop ("nudging for text output") which wastes tokens and never resolves. Detecting them early lets the engine fail fast on refusals and trigger compaction on context overflow instead of spinning.

## What Changes

- Parse `stop_reason` from the `message_delta` SSE event in `stream()`
- Parse `stop_reason` from the non-streaming `turn()` JSON response
- Yield a new `StreamEvent` type `{ type: "stop_reason"; reason: string }` from `stream()` when the reason is non-standard
- In `runExecution`, detect `stop_reason: "refusal"` → log the refusal and surface it as an execution error (no retry)
- In `runExecution`, detect `stop_reason: "model_context_window_exceeded"` → trigger compaction immediately rather than nudging
- Add `stop_reason` to the `AITurnResult` text variant so `turn()` callers can inspect it

## Capabilities

### New Capabilities

- `stop-reason-handling`: Detection and appropriate handling of non-standard Anthropic stop reasons (`refusal`, `model_context_window_exceeded`) in both streaming and non-streaming paths.

### Modified Capabilities

*(none — no existing spec requirements change; this is new behavior)*

## Impact

- `src/bun/ai/types.ts` — extend `AITurnResult` text variant with optional `stopReason`; add `stop_reason` StreamEvent
- `src/bun/ai/anthropic.ts` — parse `stop_reason` in `stream()` and `turn()`
- `src/bun/workflow/engine.ts` — branch on stop reason in the agentic loop instead of nudging
