## Why

Sub-agents account for ~82% of execution cost today because each spawned agent starts with a cold Anthropic cache (0% hit on first call), pays full cache-write rates, and frequently truncates output at the 8K token cap — triggering expensive retry loops. Meanwhile the orchestrator's own cache thrashes every 10 rounds because session notes are injected directly into the system block, invalidating the entire conversation prefix when they update. Claude Code has solved both problems through full-context agent forking, stable system prefixes, and server-side context pruning. We can adopt the same architecture.

## What Changes

- **Full-context sub-agent forking**: When spawning a sub-agent, pass the parent's full assembled conversation (system + tools + history) as the starting context instead of a fresh `[system, user]` pair. The sub-agent's first API call will share the parent's cache prefix → near-100% cache hit instead of 0%.
- **System prefix stability**: Split the single joined system block into two: a stable block (stage instructions, task, worktree) with `cache_control`, followed by a variable block (session notes, active todos) without — or moved into a user-turn injection. This preserves the cacheable prefix regardless of session note updates.
- **Max-tokens escalation for sub-agents**: Start sub-agent calls at `maxTokens: 8192`. If `stop_reason === "max_tokens"`, automatically retry with `maxTokens: 64000`. Eliminates the truncation retry spiral (10/14 results truncated in exec 91).
- **Micro-compaction of old tool results**: Replace tool results older than a configurable threshold with a `"[Cleared — content compacted]"` placeholder before sending to Anthropic. Keeps conversation growth bounded and reduces cache write cost.
- **Server-side context pruning (`clear_tool_uses`)**: Send an Anthropic beta `context_edit_strategy` header that tells the server to internally clear old tool results once input tokens exceed a threshold. This lets the cache prefix stay intact while the model operates on a trimmed view.
- **Cache break detection**: Before each API call, hash the system prompt, tool definitions, and settings separately. Log whenever a hash changes with the component name so cache misses have a traceable cause.

## Capabilities

### New Capabilities
- `subagent-context-fork`: Mechanism to fork the parent's assembled message context into a sub-agent, enabling cache prefix sharing across the spawn boundary.
- `max-tokens-escalation`: Automatic retry with elevated `maxTokens` when a sub-agent hits `stop_reason: max_tokens`.
- `tool-result-compaction`: Client-side compaction of old tool results in conversation history before API dispatch.
- `cache-break-detection`: Per-round hashing of system, tools, and settings to detect and log cache-busting changes.

### Modified Capabilities
- `spawn-agent`: Gains context-fork mode — sub-agents receive parent conversation prefix instead of starting fresh.
- `anthropic-provider`: Adds `clear_tool_uses` context edit strategy header, max-tokens escalation retry, and cache break detection.
- `session-memory`: Session notes moved out of the stable system block to prevent cache invalidation on every 5th round.
- `micro-compact`: Extends existing compaction to replace old tool results with placeholders before dispatch.

## Impact

- `src/bun/workflow/engine.ts` — sub-agent forking, system block split, session notes placement
- `src/bun/ai/anthropic.ts` — `clear_tool_uses` header, max-tokens escalation, cache break detection hashing
- `src/bun/workflow/session-memory.ts` — session notes no longer injected into stable system prefix
- `src/bun/handlers/tasks.ts` — sub-agent spawn receives forked context
- Test suite: providers.test.ts and engine integration tests will need updates for new retry behavior and forked context shape
