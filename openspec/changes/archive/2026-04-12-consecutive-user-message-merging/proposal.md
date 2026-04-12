## Why

Anthropic's API and many OpenAI-compatible providers (especially those using Jinja chat templates like Qwen3) reject requests that contain back-to-back messages with the same role. Consecutive `user` turns arise in several legitimate scenarios: two consecutive tool result messages that fail to merge in `adaptMessages()`, compaction summary injection before a user message, or `on_enter_prompt` being prepended to an existing user history entry. Today the engine handles one of these cases specifically (for Qwen3), but the guard is not universal. A production execution with any other affected model will get a silent HTTP 400.

## What Changes

- **Universal message normalization pass in `adaptMessages()`** (Anthropic) and in the OpenAI-compatible message mapper:
  - After all other adaptation, scan the resulting messages array for consecutive messages with the same role.
  - Merge consecutive `user` messages: concatenate their content with a `\n\n` separator.
  - Merge consecutive `assistant` messages: concatenate text content; tool_calls from each merged assistant message are combined.
- **Remove engine-specific Qwen3 workaround**: the existing logic in `assembleMessages()` that avoids consecutive user turns for Qwen3 can be simplified or removed once normalization is guaranteed at the provider layer.
- **Applies to both providers**: consecutive-role merging is in `adaptMessages()` for Anthropic and in `toWireMessage()` / `stream()` pre-processing for `OpenAICompatibleProvider`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `ai-provider`: `adaptMessages()` and OpenAI-compatible message mapping guarantee no consecutive same-role messages in the wire payload; this is a precondition for provider compatibility.

## Impact

- `src/bun/ai/anthropic.ts` — `adaptMessages()` gains a post-processing normalization pass
- `src/bun/ai/openai-compatible.ts` — `stream()` and `turn()` gain a normalization step before building the wire body
- `src/bun/workflow/engine.ts` — `assembleMessages()` Qwen3-specific guard may be simplified
- No DB, frontend, or type changes
- Test coverage: unit tests for both providers' normalization covering back-to-back user, back-to-back assistant, and mixed sequences
