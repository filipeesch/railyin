## Context

Our current implementation with `interleaved-thinking-2025-05-14` does NOT round-trip thinking blocks back to the model. Reasoning tokens (`{ type: "reasoning" }` StreamEvents) are stored as separate `reasoning`-type database messages and are filtered out by `compactMessages()` before the next API call. Because our `AIMessage` type has no thinking block field, `adaptMessages()` never includes thinking blocks in the outgoing payload.

However, a different class of orphan CAN occur: during an active execution, `liveMessages` is built incrementally. If the engine calls `provider.stream()` and the model sends only thinking deltas but no text/tool_use (e.g. it times out mid-reasoning), the engine pushes the assistant message with `content: null, tool_calls: undefined` to `liveMessages`. On the next API call attempt (after retry), this empty-content assistant turn is included and triggers a 400 from Anthropic — "_messages: ... assistant turn must contain at least one content block of type text or tool_use_".

For future-proofing: if we later begin preserving thinking blocks (to properly implement extended thinking round-trips), the Anthropic API requires that orphaned thinking-only turns are filtered.

## Goals / Non-Goals

**Goals:**
- Filter empty-content assistant messages from `liveMessages` before each API call to prevent Anthropic 400 errors
- Add the filter hook in `adaptMessages()` or as a normalization pass in `stream()` / `turn()` — no engine changes
- Cover the round-trip thinking block case proactively so the codebase is ready if we add thinking preservation later

**Non-Goals:**
- Changing how reasoning tokens are stored (still `reasoning`-type DB messages, not in `assistant` content)
- Preserving thinking blocks across executions (that requires a separate design for round-trip thinking)
- Applying filtering to OpenAI-compatible providers (thinking blocks are not present in their wire format)

## Decisions

### D1: Pre-flight normalization strip in `adaptMessages()` before building the Anthropic payload

`adaptMessages()` receives `AIMessage[]`. We add a normalization step at the entry of the function that removes:
1. **Empty-content assistant messages**: assistant messages where `content` is null, empty string, or whitespace-only AND `tool_calls` is absent or empty. These come from interrupted streaming rounds.
2. **Future-proofing hook**: when thinking blocks are eventually added to `AIMessage`, the filter will also remove assistant messages containing ONLY thinking blocks (detected by a `thinkingBlocks?: unknown[]` field with empty or absent text/tool_use).

The filter runs on the input `AIMessage[]` before any other logic, since later steps depend on message order.

### D2: Re-derive orphan condition from message fields — no new type flag

Rather than adding `isOrphanThinkingRound: boolean` to `AIMessage`, we derive the condition from existing fields: `role === "assistant" && !content?.trim() && !tool_calls?.length`. This is equivalent and requires no type changes. A helper `isEmptyAssistantMessage(m: AIMessage): boolean` encapsulates the check.

### D3: Log orphan removal with task/execution IDs for monitoring

When a message is filtered, log at `warn` level so we can track how often this occurs in production. Frequent occurrence would indicate a systemic execution interruption issue worth investigating separately.

## Risks / Trade-offs

- **Over-filtering**: We might remove a legitimate assistant message that had an empty text response. In practice, when an assistant produces no text and no tools, the engine already nudges it (existing "empty response" nudge logic). If the engine pushes such a message to `liveMessages`, filtering it is correct — sending an empty assistant turn to the API would fail anyway.
- **Loss of ordering context**: removing an empty assistant message may cause two consecutive user messages (the preceding prompt and the next tool result). This is handled by T8 (consecutive user message merging). These two changes work in concert.
