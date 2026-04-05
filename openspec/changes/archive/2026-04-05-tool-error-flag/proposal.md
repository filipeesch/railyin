## Why

When a tool fails, the model receives the error text as a plain `content` string with no error signal — identical in structure to a successful tool result. Anthropic's API supports an `is_error: true` flag on `tool_result` content blocks that gives the model a strong signal that the result represents a failure rather than a valid output. Without this flag, models may try to use an error string as data or fail to recognize that a retry or alternative approach is needed.

## What Changes

- **`is_error` flag on failed tool results (Anthropic wire format)**: when `executeTool()` returns an error string (detected by the `"Error:"` prefix convention already used throughout `tools.ts`), the assembled `tool_result` block sent to Anthropic's API will include `is_error: true`.
- **`isError` field on internal AIMessage**: the `AIMessage` type gains an optional `isError?: boolean` field so tool result messages can carry the error flag through the message pipeline.
- **`adaptMessages()` in `anthropic.ts`**: when building `tool_result` content blocks, propagates `isError` → `is_error: true` on the Anthropic wire object.
- **OpenAI-compatible providers**: no wire change (the OpenAI messages API has no `is_error` equivalent). The internal `isError` field is silently ignored in `toWireMessage()`.
- **Engine**: `liveMessages.push({ role: "tool", ... })` gains `isError: true` when the tool result is an error.

## Capabilities

### New Capabilities

### Modified Capabilities
- `ai-provider`: `AIMessage` for tool results gains optional `isError?: boolean`; `adaptMessages()` in Anthropic implementation propagates this to wire format `is_error: true`.

## Impact

- `src/bun/ai/types.ts` — add `isError?: boolean` to `AIMessage`
- `src/bun/ai/anthropic.ts` — `adaptMessages()` includes `is_error: true` in tool_result blocks when `msg.isError` is set
- `src/bun/workflow/engine.ts` — detect error result from `executeTool()`, set `isError: true` on the message pushed to `liveMessages`; no DB schema change needed (isError is in-memory only, not persisted)
- No frontend changes
