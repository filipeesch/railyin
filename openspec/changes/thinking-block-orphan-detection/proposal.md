## Why

Anthropic's API returns HTTP 400 when a `messages` array contains an assistant message that consists exclusively of thinking (reasoning) blocks with no text or tool_use content — a structure the API calls an "orphaned thinking block". This situation arises when conversation compaction aborts mid-stream or when an execution is cancelled after reasoning tokens arrive but before any text or tool call is emitted. Today this produces an unrecoverable 400, failing the task with a cryptic error.

## What Changes

- **Pre-flight orphan filter in `adaptMessages()`**: before building the Anthropic wire payload, apply two filtering rules:
  1. **Remove thinking-only assistant messages**: any assistant message in history whose content consists exclusively of thinking blocks (no text blocks, no tool_use blocks) is dropped entirely.
  2. **Strip trailing thinking blocks from the last assistant message**: if the last assistant message in history has trailing thinking blocks after its text or tool_use content, those trailing blocks are removed.
- **Anthropic-only**: this filter runs inside `adaptMessages()` in `anthropic.ts`, not in the engine or in the shared AIMessage pipeline. OpenAI-compatible providers do not use thinking block structures.
- **No lossy truncation of meaningful content**: the filter only removes thinking-only messages (no text/tool output was emitted to the user anyway). Text and tool_use blocks are always preserved.

## Capabilities

### New Capabilities

### Modified Capabilities
- `model-reasoning`: Add requirement that reasoning content orphaned by abrupt completion must be filtered before retransmission to the provider.

## Impact

- `src/bun/ai/anthropic.ts` — `adaptMessages()` gains a pre-processing pass that removes orphaned thinking blocks and strips trailing thinking from the last assistant message
- `src/bun/ai/types.ts` — no changes (the thinking block notion is local to the Anthropic wire type; `AIMessage` uses `role: "assistant"` with `content` string and `tool_calls` — no thinking field)
- No engine, DB, or frontend changes
- Test coverage: add unit tests for `adaptMessages()` covering the two filter rules
