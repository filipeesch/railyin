## Context

Railyin's agentic execution loop spawns sub-agents via `spawn_agent` tool calls. Today each sub-agent starts with a fresh two-message conversation (`[system, user]`) built from the column instructions and a task description. This means:

1. **Zero cache reuse**: Every sub-agent's first Anthropic API call is a cold write (0% cache hit). For exec 91, sub-agents were responsible for ~$0.54 of $0.66 total (82%).
2. **Truncation retry loops**: Sub-agents default to `maxTokens: 8192`. In exec 91, 10/14 tool results were truncated at that cap, and the orchestrator spawned repeated sub-agents to retry — each incurring more cold cache writes.
3. **Session notes cache thrash**: Session notes are injected into the stable system block via `adaptMessages()` which joins all system messages into a single Anthropic system block with `cache_control`. When `extractSessionMemory()` fires every 5 rounds and updates the notes, the entire system hash changes → full cache miss (~$0.29 per occurrence).

Claude Code solves these with fork sub-agents (full context inheritance), a stable system prefix, max-tokens escalation, and server-side context trimming (`clear_tool_uses`). This design adopts those patterns for Railyin.

## Goals / Non-Goals

**Goals:**
- Sub-agents share the parent's cache prefix → cache hit on first call instead of cold write
- Session memory updates no longer bust the system cache
- Sub-agent output truncation triggers an automatic retry with elevated `maxTokens`
- Old tool results compacted from conversation before dispatch to keep token growth bounded
- Server-side `clear_tool_uses` strategy sent to Anthropic to allow cache-safe context trimming
- Cache break detection: log which component caused a cache miss each round

**Non-Goals:**
- Server-side fork APIs (Anthropic API-side task budget — still in private beta, skip for now)
- Full Claude Code `forkSubagent` worktree isolation (Railyin handles isolation differently via git worktree per execution)
- Cross-execution cache sharing (executions are isolated by design)
- Changing the sub-agent permission or tool model

## Decisions

### D1: Pass assembled parent context to sub-agents, not raw history

When the orchestrator calls `spawn_agent`, instead of building a fresh `[system, user]` context inside the sub-agent runner, pass the parent's already-assembled `messages` array (the same array that was just sent to the Anthropic API). The sub-agent appends its own instruction as a new user message at the end.

**Why**: The parent's messages array has already been through `adaptMessages()` and is in Anthropic wire format with cache_control applied. A sub-agent that starts from this prefix will get near-100% cache hit on the system + tools + all prior turns.

**Alternative considered**: Pass only the system blocks (not full history). Simpler but sub-agent still pays a 0% hit for the tool definitions block. Full history maximizes reuse.

**Trade-off**: Sub-agent input tokens increase (includes full parent history). But since these are cache reads at $0.30/MTok vs cold writes at $6/MTok, the cost is ~20× lower.

### D2: Split system into stable + variable blocks

Currently `adaptMessages()` joins ALL system messages into one block with `cache_control`. Instead:
- **Stable block** (stage instructions + task title/description + worktree context): joined as a single block with `cache_control: { type: "ephemeral", ttl: "1h" }`. Never changes within an execution.
- **Variable block** (session notes + active todos): separate block WITHOUT `cache_control`, placed after all conversation history as a final user-turn injection (e.g. `<context>\n...\n</context>`).

**Why**: The stable block is the cache anchor. Moving variable content out of it means session note updates (every 5 rounds) and todo list changes no longer invalidate the cache.

**Alternative considered**: Keep notes in system but hash-check before updating — only write if content actually changed. Rejected because todos change every round too, and the problem is structural.

### D3: Max-tokens escalation with one retry

Sub-agents and direct tool calls that hit `stop_reason: "max_tokens"` retry automatically with `maxTokens: 64000`. The retry reuses the same messages (no state change), so it's just one additional API call.

**Why**: Claude Code's P99 output is ~4.9K tokens, so 8K covers almost all cases. But when it doesn't (file reads, dense code), the current behavior silently truncates. One retry at 64K eliminates the spiral of re-spawning sub-agents asking "return full content, don't truncate".

**Alternative considered**: Always use 64K. Rejected — Anthropic reserves output slots; larger `max_tokens` values reduce server-side concurrency.

### D4: Client-side tool result compaction (micro-compaction)

Before each API call, scan conversation history for `tool_result` messages older than the last N turns (configurable, default: last 5 tool call/result pairs kept). Replace the `content` of older ones with `"[Cleared — content compacted to reduce context size]"`. This is done in `compactMessages()` before dispatch.

**Why**: Keeps conversation token growth O(N) rather than O(conversations × result_size). Prevents context window pressure that would force expensive full compaction.

**Alternative considered**: Server-side `clear_tool_uses` (D5) instead of client-side. Both are complementary — client-side compaction is under our control and doesn't require a beta header.

### D5: Server-side `clear_tool_uses` context edit strategy

Add the `anthropic-beta: context-editing-2025-10-01` header when making Anthropic calls. Include a `context_edit_strategy` body parameter:
```json
{
  "type": "clear_tool_uses_20250919",
  "trigger": { "type": "input_tokens", "value": 80000 },
  "keep": { "type": "tool_uses", "value": 20000 },
  "clear_at_least": { "type": "input_tokens", "value": 20000 }
}
```
The server trims tool results internally without the client changing the message array, keeping the cache prefix valid.

**Why**: Server-side trimming doesn't affect the cache key (determined by what we send, not what the server processes). Combined with client-side compaction (D4), this provides dual-layer context management.

**Risk**: This is a beta header. If Anthropic deprecates or changes it, we need to fall back gracefully. Wrap behind a config flag `anthropic.context_edit_strategy.enabled` (default: true).

### D6: Cache break detection via per-round hashing

Before each API call, compute:
- `systemHash`: SHA-256 truncated to 8 chars of the stable system block content
- `toolsHash`: SHA-256 truncated to 8 chars of the serialized tool definitions
- `historyLen`: number of messages in the assembled conversation

On each round, if the system or tools hash changed from the previous round, emit a WARN log: `[cache] System hash changed: <old> → <new> (session notes update? tool change?)`. This gives observability into exactly when and why cache is busting.

**Why**: Currently cache misses are only visible by inspecting `cache_read=0` in usage logs, with no indication of cause. Detection closes the observability gap.

## Risks / Trade-offs

- **Forked context size**: Sub-agents receive the parent's full history. For long executions (100+ rounds), this could push sub-agent input tokens very high. Mitigation: D4 micro-compaction trims old results before the fork. Additionally, `clear_tool_uses` (D5) handles server-side trimming.

- **Session notes as user-turn injection**: Moving notes out of the system block means they appear in the conversation messages, which could affect model behavior (system prompts are treated with higher authority than user messages). Mitigation: Wrap in a clearly labeled `<session_context>` XML tag; models treat this as authoritative context in practice.

- **`clear_tool_uses` beta header**: If Anthropic rejects or ignores the beta header, the call still succeeds — it just doesn't benefit from server-side trimming. No functional regression. Mitigation: Config flag to disable if needed.

- **Max-tokens escalation doubles API cost on truncated calls**: A call that truncates at 8K and retries at 64K pays for two calls. But this is strictly better than the current behavior of paying for N re-spawned sub-agent calls to recover the same data.

- **Cache break detection hashing overhead**: Computing SHA-256 on system + tools each round adds negligible CPU overhead (microseconds vs seconds per API call).

## Migration Plan

1. Deploy changes to `anthropic.ts` (stable system block split, `clear_tool_uses` header, max-tokens escalation, cache break detection) — these are backward-compatible.
2. Deploy changes to `engine.ts` (sub-agent forking, session notes injection change, micro-compaction) — these change conversation structure for new executions only; existing executions in the DB are unaffected.
3. Monitor first few executions post-deploy: verify cache hit rates improve (system hash stable across rounds, sub-agents show >80% cache hit on first call).
4. If `clear_tool_uses` causes unexpected errors, flip `anthropic.context_edit_strategy.enabled: false` in config.

## Open Questions

- **Which beta string?** The free-code source uses `context-editing-2025-10-01`. Confirm this is still the current Anthropic beta header name before shipping D5.
- **Micro-compaction threshold**: The default "keep last 5 tool result pairs" is a guess. Should be measured against actual executions after initial ship.
- **Sub-agent forking scope**: Should ALL sub-agents receive the full context, or only top-level ones (not recursive sub-agents of sub-agents)? Start with all; revisit if recursive depth causes token bloat.
