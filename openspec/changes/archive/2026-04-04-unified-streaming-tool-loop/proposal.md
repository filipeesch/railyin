## Why

The engine uses two separate AI call paths — a non-streaming `turn()` for tool-call rounds and a streaming `chat()` for the final text response — which leaves the model in an inconsistent state at the end of each execution: tools are no longer available, but the model has seen tool usage in its context and sometimes emits tool-call syntax as raw text. These rogue blobs are silently ignored, the user sees missing or corrupted output, and re-feeding them into history confuses future turns.

## What Changes

- **Merge `turn()` and `chat()` into a single unified streaming call `stream()`** that always passes tools, handles both `delta.tool_calls` and `delta.content` SSE chunks in the same stream, and returns either text tokens or structured tool calls.
- **Remove the separate final `chat()` call from the engine** — the tool loop itself runs until the model produces text with no tool calls; that text is the final response, streamed live.
- **Delete `chat()` from `AIProvider`** — single `stream()` method covers all cases.
- **Update `FakeAIProvider`** to implement `stream()` instead of `turn()` + `chat()`.
- **Update engine tests** to reflect the unified call path.

## Capabilities

### New Capabilities

- `unified-ai-stream`: A single streaming method on `AIProvider` that passes tool definitions on every call and yields either text tokens or structured tool call events; the caller decides how to handle each.

### Modified Capabilities

- `ai-provider`: The `AIProvider` interface loses `chat()` and `turn()`, gains `stream()`. Breaking change to the provider contract.
- `workflow-engine`: The `runExecution` tool loop calls `stream()` for every round; the final response is the text yielded when the model produces no tool calls rather than a second call to `chat()`.

## Impact

- `src/bun/ai/types.ts` — `AIProvider` interface, `AITurnResult` type
- `src/bun/ai/openai-compatible.ts` — replace `turn()` + `chat()` with `stream()`
- `src/bun/ai/fake.ts` — replace `turn()` + `chat()` with `stream()`
- `src/bun/workflow/engine.ts` — merge the two call sites into one unified loop
- `src/bun/test/engine.test.ts` — update fake provider usage
- No database schema changes, no RPC changes, no frontend changes
