## Context

`AnthropicProvider` sends `system` as a plain string on every API call. Anthropic's messages API supports a content-block array form for `system` that allows individual blocks to carry `cache_control: { type: "ephemeral" }` markers. When a block is marked, Anthropic caches all tokens up to and including that block, charging ~10% of the normal input token rate on subsequent hits. Our system prompt + tool specification is 1,000–3,000 tokens and identical across every tool-loop round within an execution — an ideal cache candidate.

Anthropic's minimum cacheable block size is 1,024 tokens (Claude 3.5+). Our system prompt consistently exceeds this. Cache TTL is 5 minutes for `ephemeral`, refreshed on each hit.

## Goals / Non-Goals

**Goals:**
- Cache the system prompt (task context, tool docs, stage instructions) across tool-loop rounds within a single execution
- Cache a conversation-history breakpoint to avoid re-processing stable prior turns on the same ongoing task
- Keep the change isolated to `anthropic.ts`; `AIProvider` interface and engine are untouched
- Validate via usage events (T4) that `cache_read_input_tokens > 0` on rounds 2+

**Non-Goals:**
- Caching for OpenAI-compatible providers — they don't support `cache_control` (field is silently ignored if sent, but we won't send it)
- Persistent cross-session caching (Anthropic handles TTL automatically; we don't need to manage it)
- Dynamic cache breakpoint selection based on measured token counts — static placement is sufficient

## Decisions

### D1: System prompt sent as a `TextBlock[]` array, last block gets `cache_control`

`adaptMessages()` currently builds `system: string` by joining all system-role messages. We'll change the return type to include `systemBlocks: AnthropicSystemBlock[]` where each block is `{ type: "text", text: string, cache_control?: { type: "ephemeral" } }`. The last block in the array gets the cache marker.

For clarity in the Anthropic API call body, emit `system: systemBlocks` (array form) when blocks are present. The Anthropic API accepts either form.

**Why last block, not first?** Anthropic caches all tokens UP TO the marked block. Marking the last system block caches the entire system prompt. Marking an earlier block would leave later blocks uncached.

**Alternative: mark a dedicated empty sentinel block.** Rejected — unnecessary complexity.

### D2: Conversation history cache breakpoint at the 5th-to-last user message

For long-running tasks with many tool-loop rounds, also place a cache breakpoint on the `user` message at index `messages.length - 5` (or the earliest available if the conversation is short). This allows Anthropic to cache all prior turns, and only the final 4–5 messages are processed fresh.

**Minimum size guard:** Only add this breakpoint if the content of the target message exceeds 100 characters (rough proxy for > 1024 tokens once combined with preceding context). Too-small conversations aren't worth the complexity.

**Why 5th-to-last?** Leaves enough buffer for the model's immediate context (current tool results, last assistant response) to be freshly processed. Claude Code uses the same heuristic.

### D3: `adaptMessages()` signature change is backward-compatible

The return type is extended: `{ system: string | undefined; messages: AnthropicMessage[]; systemBlocks: AnthropicSystemBlock[] | undefined }`. Both `turn()` and `stream()` in `AnthropicProvider` already call `adaptMessages()` and build the request body — they'll use `systemBlocks` when present, falling back to `system` for backward compatibility with tests.

## Risks / Trade-offs

- **Cache miss on first call per task execution**: expected — no cost impact, cache warms on round 1.
- **Cache invalidation on system prompt change**: if stage_instructions differ between runs (different workflow column), the cache misses. This is fine — the cache is per-call content, not persistent state.
- **Minimum size threshold**: very short tasks may never hit 1024 tokens in the system block; Anthropic silently ignores the cache_control in that case (no error, just no cache hit).
- **Beta header interaction**: caching requires no additional beta header for `claude-3-5-*` and `claude-3-7-*`. The existing `anthropic-beta: interleaved-thinking-2025-05-14` header is unrelated. Confirm prompt caching does not require an additional `anthropic-beta: prompt-caching-2024-07-31` header on newer API versions — the docs indicate it became GA and no longer requires the beta header.
