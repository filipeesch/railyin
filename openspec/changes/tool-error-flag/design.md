## Context

`executeTool()` in `tools.ts` returns either a `WriteResult` (success with diff) or a `string`. Error strings always start with `"Error:"` — this is a convention used consistently throughout all switch cases in `executeTool()`. When the engine pushes a tool result back to `liveMessages` and eventually to `adaptMessages()` in `anthropic.ts`, it becomes a plain `tool_result` content block with no error marker.

Anthropic's messages API has a dedicated `is_error: true` field on `tool_result` content blocks (`{ type: "tool_result", tool_use_id: "...", content: "...", is_error: true }`). This signals to the model that the tool call failed, rather than returned an unusual string value.

OpenAI's chat completions API has no equivalent field — tool results are always plain content strings. The `is_error` flag is Anthropic-exclusive at the wire level, but having the semantic in the AIMessage layer lets us propagate it to any provider that adds support in the future.

## Goals / Non-Goals

**Goals:**
- Propagate `is_error: true` to Anthropic wire format when a tool result represents a failure
- Add `isError?: boolean` to `AIMessage` so the flag travels from engine to `adaptMessages()` without provider-specific branching in the engine
- Detect errors via the existing `"Error:"` prefix convention — no changes to `executeTool()`'s return type

**Non-Goals:**
- Changing `executeTool()` return type to a discriminated union — the `"Error:"` prefix convention is sufficient and widely used
- Surfacing `is_error` in the conversation UI (the error text already shows in tool_result bubbles)
- Adding `is_error` to OpenAI-compatible wire format (not supported; silently omitted)

## Decisions

### D1: Detection at the engine level, flag carried via `AIMessage.isError`

After `executeTool()` returns, the engine already has the full result string. It checks `llmContent.startsWith("Error:")` and sets `isError: true` on the `AIMessage` it pushes to `liveMessages`. The `role: "tool"` message in our `AIMessage` type gains `isError?: boolean`.

**Why not in `adaptMessages()`?** `adaptMessages()` receives `AIMessage[]` and sees only the content string — it would have to re-apply the prefix-detection heuristic. Putting detection at the engine level is the single source of truth.

**Alternative: change `executeTool()` return type.** Rejected — requires touching every return site in `tools.ts` (many) and would make the return type more complex without material benefit.

### D2: `adaptMessages()` in `anthropic.ts` propagates `isError` to `is_error`

The `tool_result` block builder in `adaptMessages()` checks `msg.isError` and includes `is_error: true` on the Anthropic content block when set. No change to any non-Anthropic code path.

### D3: `isError` on `liveMessages` only — not persisted to DB

`isError` is an in-flight signal for the current API call. The DB stores the error text (with its `"Error:"` prefix) in the `tool_result` message content, which is enough for the UI and for compaction. The `isError` flag is re-derived if the message is ever re-assembled from DB (by the same engine-level `startsWith("Error:")` check).

## Risks / Trade-offs

- **`"Error:"` prefix convention**: this is load-bearing. If any tool ever returns `"Error:"` as a legitimate non-failure value we'd generate a spurious `is_error: true`. Currently no tool does this — all successful results start with `"OK:"` or file content.
- **Minimal model behaviour change**: Anthropic documentation states `is_error` "gives the model a better signal" but does not mandate behaviour changes. Some models may retry the same tool or prompt differently. This is the desired outcome.
