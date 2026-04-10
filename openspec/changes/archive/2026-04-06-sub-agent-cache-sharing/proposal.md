## Why

Sub-agents spawned via `spawn_agent` each start a fresh conversation with only their `instructions` string — no system prompt, no shared context. Every sub-agent `retryTurn` call sends tool definitions as uncached input tokens, consuming the full ITPM rate limit budget. When multiple sub-agents run in parallel via `Promise.all`, they collectively exhaust the token-per-minute budget within a few rounds, triggering 429 cascades. Anthropic's prompt caching means cached tokens don't count toward ITPM rate limits, so sharing a cached prefix across sub-agents would effectively multiply the available rate limit headroom.

## What Changes

- **Sub-agent system prompt injection**: `runSubExecution` will prepend a minimal system message containing the tool definitions, matching the parent's tool-definition block structure so Anthropic's prefix-matching cache can recognize the shared prefix across concurrent children.
- **Stable tool ordering**: Tool definitions passed to sub-agents will use a deterministic order (sorted by name) so all children produce byte-identical tool definition prefixes, maximizing cache hits.
- **`cache_control` on sub-agent system block**: The system message block in sub-agent calls will carry `cache_control: { type: "ephemeral" }` so the first child's call warms the cache and subsequent children read from it at zero ITPM cost.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `spawn-agent`: Sub-agent executions prepend a system message with sorted tool definitions and a cache breakpoint, enabling cross-child prompt cache sharing
- `anthropic-provider`: `adaptMessages()` propagates `cache_control` markers on system blocks for non-streaming `turn()` calls (used by sub-agents)

## Impact

- `src/bun/workflow/engine.ts`: `runSubExecution` — add system message with tool definitions to `liveMessages` before first `retryTurn` call; sort `toolDefs` by name
- `src/bun/ai/anthropic.ts`: `adaptMessages()` — support `cache_control` on system content blocks in the adapted output (may already be covered by the prompt-caching change)
- No DB schema changes
- No frontend changes
- Depends on `prompt-caching` change being implemented first (for the `cache_control` wire format support in `adaptMessages`)
