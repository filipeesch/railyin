## Context

Both Anthropic's messages API and most OpenAI-compatible providers using Jinja-templated chat formats (Qwen3, any conversation-template-based model) reject requests with consecutive messages of the same role. The Anthropic API returns a 400 with "_messages: roles must alternate_". Qwen3's Jinja template throws "_No user query found in messages_".

Our `assembleMessages()` function in `engine.ts` already has a Qwen3-specific guard that merges the triggering message with the last user turn to avoid a trailing duplicate. But consecutive user turns can arise earlier in the assembled history from:
1. Two `tool` role messages in a row that become consecutive user messages after `adaptMessages()` processes them (normally merged, but edge cases exist).
2. Compaction summary injection: a `compaction_summary` produces a `user` message followed by the real next user message.
3. `on_enter_prompt` system-injected turns adjacent to stored user turns.
4. Orphaned thinking removal (T7) removing an intervening assistant message, leaving two user turns adjacent.

A universal normalization pass at the provider level is more robust than individual guards in the engine.

## Goals / Non-Goals

**Goals:**
- Merge consecutive same-role messages into one at the `adaptMessages()` / wire pre-processing stage for both providers
- Handle `user` + `user` (most common), `assistant` + `assistant` (less common)
- Make the Qwen3-specific engine guard redundant (leaving it as defense-in-depth is acceptable)
- Apply universally — benefits all provider types, not just Qwen3 or Anthropic

**Non-Goals:**
- Merging `tool` role messages (these are already handled by the tool_result block merging logic in `adaptMessages()` for Anthropic)
- Changing engine-level `assembleMessages()` logic (normalization at provider level is the right boundary)
- Eliminating the existing Qwen3 guard in `assembleMessages()` in this change (can be done as cleanup separately)

## Decisions

### D1: Normalization runs as a final post-processing pass after `adaptMessages()` produces the wire array

For Anthropic: after the loop in `adaptMessages()` builds `adapted: AnthropicMessage[]`, a `mergeConsecutiveSameRole()` helper collapses consecutive same-role entries before the function returns.

For OpenAI-compatible: a `normalizeMessages()` helper is applied to `messages.map(toWireMessage)` inside `stream()` and `turn()` before the body is built.

Both helpers implement the same algorithm: scan the array, when `messages[i].role === messages[i+1].role`, merge them:
- For `user` + `user`: concatenate `content` with `"\n\n"` separator (or combine block arrays for Anthropic structured content).
- For `assistant` + `assistant`: concatenate text content; combine `tool_calls` arrays.

### D2: Content concatenation handles both string and block-array forms

Anthropic `user` content can be either a `string` or a `ContentBlock[]`. The merger handles: string+string, string+blocks, blocks+blocks. Result is always `ContentBlock[]` when either input was blocks (safe to upgrade).

OpenAI-compatible messages always use string `content`, so the merger is simpler.

### D3: Two-pass not needed — a single scan handles arbitrary runs of same-role messages

The algorithm replaces messages[i] with the merged value and removes messages[i+1], then re-checks messages[i] against the new messages[i+1]. This handles runs of 3+ consecutive same-role messages correctly in one pass.

## Risks / Trade-offs

- **Content integrity**: merging with `"\n\n"` adds whitespace. For tool_result blocks, the content is already separated by block boundaries — no text-level merging of tool_result content occurs, only merging of the wrapping user message when tool results from two separate rounds accidentally end up adjacent (extremely rare given the tool_result merging logic already present).
- **Interleaved-thinking requirement**: Anthropic's extended thinking requires strict alternation including thinking blocks. If T7 (orphan detection) is implemented, the cases where this normalization is needed are already reduced to edge cases. The two changes are complementary.
