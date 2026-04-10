## Context

Claude 4+ models (`claude-sonnet-4-5`, `claude-opus-4-6`, `claude-sonnet-4-6`, etc.) introduced two stop reasons that didn't exist in Claude 3:

- `refusal` — model refuses the request (content policy, safety). Nudging won't help.
- `model_context_window_exceeded` — generation stopped because the context window is full, not because `max_tokens` was hit. Nudging won't help; compaction is needed.

Currently both arrive in the `message_delta` SSE event's `delta.stop_reason` field (and in the non-streaming response's top-level `stop_reason`). We ignore both. The engine sees an empty text response and tries nudging, burning tokens without making progress.

The `message_delta` event shape is:
```json
{ "type": "message_delta", "delta": { "stop_reason": "refusal", "stop_sequence": null }, "usage": { "output_tokens": 12 } }
```

## Goals / Non-Goals

**Goals:**
- Detect `stop_reason` in `stream()` (from `message_delta`) and `turn()` (from top-level JSON)
- Surface it to the engine via a new `stop_reason` StreamEvent and extended `AITurnResult`
- In the engine agentic loop: short-circuit on `refusal` with an error message; trigger compaction on `model_context_window_exceeded`

**Non-Goals:**
- Handling all possible stop reasons (only the two new ones that need special behavior)
- Changing retry logic for these stop reasons (no retry; they're terminal for the round)
- Handling `refusal` in sub-agents differently — sub-agents return an error string, which is already the correct behavior

## Decisions

### Propagate stop_reason as a StreamEvent, not a thrown error

**Decision:** Yield `{ type: "stop_reason"; reason: string }` from `stream()` when `stop_reason` is non-standard (`refusal` or `model_context_window_exceeded`). The engine consumes this event in its event loop.

**Rationale:** Throwing in the stream would bypass the engine's normal event processing. A StreamEvent keeps the same flow.

**Alternative:** Throw a typed `ProviderError` subclass. Rejected — `ProviderError` is for HTTP-level failures; stop reasons are application-level outcomes.

### `AITurnResult` text variant gains optional `stopReason`

**Decision:** Extend `{ type: "text"; content: string }` to `{ type: "text"; content: string; stopReason?: string }`.

**Rationale:** `turn()` is synchronous and can't yield events. The only clean way to carry stop reason through the `turn()` interface is on the return value.

### Engine branches: refusal → error message appended; context_window_exceeded → trigger compaction

**Decision:**
- `refusal`: append a final `assistant` message to the DB and `liveMessages` noting the refusal, then end the execution with an error.
- `model_context_window_exceeded`: immediately call `compactConversation()` and re-run the last round.

**Rationale:** These are the purpose-built recovery paths already in the engine — we're just routing to them correctly instead of falling through to the nudge loop.

## Risks / Trade-offs

- **Unknown future stop reasons** → Mitigation: log all non-`end_turn`/`tool_use`/`max_tokens` stop reasons at warn level so we notice new ones.
- **Compaction loop risk** → If context is already near-max after compaction, `model_context_window_exceeded` could cycle. Mitigation: existing compaction guard (`compactionAttempted` flag) prevents infinite loops.
