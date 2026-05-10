## Context

The Pi engine integrates local LLMs (LM Studio, Ollama) via the `@earendil-works/pi-coding-agent` SDK. Three subsystems are currently broken:

1. **ContentHashCache** — a Claude-era optimization that sends `"[file unchanged since turn N — use your cached version]"` to local LLMs. Local models have no prompt cache; they hold full history in their context window. These messages are meaningless noise that confuses the model and wastes context tokens.

2. **Compaction** — Pi SDK (`AgentSession`) has full built-in compaction: `session.compact()`, auto-compact at threshold, and `compaction_start`/`compaction_end` events. `PiEngine.compact()` currently ignores all of this and only resets hash cache flags. The `event-translator.ts` drops `compaction_start`/`compaction_end` from the Pi SDK event stream, so neither auto nor manual compaction propagates to Railyin's stream processor.

3. **Context gauge** — Pi never emits a `usage` EngineEvent, so `ContextEstimator` always falls back to the slow path (chars ÷ 4) against a hardcoded 128,000 token max. Pi SDK exposes `session.getContextUsage()` which returns `{ tokens, contextWindow, percent }` — the accurate live values — but they are never surfaced.

## Goals / Non-Goals

**Goals:**
- Remove `ContentHashCache` entirely from Pi tools — cleaner, less confusing
- Wire Pi SDK compaction so auto-compact and manual compact both work end-to-end
- Emit `usage` EngineEvents from Pi so `ContextEstimator` uses the fast path with real token counts
- Surface `contextWindow` in `listModels()` so the gauge max is accurate

**Non-Goals:**
- Server-side (Railyin-owned) AI summarization for Pi — Pi SDK handles compaction internally using the local model; we delegate to it entirely
- Configuring the Pi SDK compaction threshold — SDK defaults are acceptable for now
- Providing context usage before the first turn — `getContextUsage()` returns `null` until the first LLM response; the gauge can remain hidden or show 0 until then

## Decisions

### Decision 1: Remove ContentHashCache entirely (not guard with a flag)
**Chosen:** Delete `hash-cache.ts` and remove all callsites.
**Alternative:** Keep behind a feature flag or make it a no-op.
**Rationale:** The cache exists solely to optimize prompt caching with Claude (where re-sending file content is expensive). Local LLMs have no prompt cache. The feature has no benefit for Pi and actively harms model quality by injecting undefined references into context. Making it a no-op is safe but leaves dead code; deletion is clean.

### Decision 2: Wire compaction via Pi SDK, not Railyin's `compactConversation()`
**Chosen:** `PiEngine.compact()` calls `session.compact()`. Pi SDK handles the compaction using the local LLM.
**Alternative:** Call Railyin's `compactConversation()` which uses a configured AI provider (Anthropic/OpenAI) to summarize, then reset the Pi session.
**Rationale:** Pi SDK's compaction is already designed for this purpose, tracks context window internally, and requires zero extra infrastructure. Using `compactConversation()` would require a separate cloud provider, complex session reset logic, and would conflict with Pi SDK's own auto-compaction. Single responsibility: Pi manages its session.

### Decision 3: `turn_end` handling stays in engine subscriber, not `translateEvent`
**Chosen:** The engine's subscriber callback handles `turn_end` by calling `session.getContextUsage()` and pushing a `usage` event.
**Alternative:** Pass a `getContextUsage` callback into `translateEvent` so all event mapping is in one function.
**Rationale:** `translateEvent` is a pure function (event → EngineEvents[]) with no side effects, making it straightforward to test. `session.getContextUsage()` requires a live session reference, making it inherently stateful. Mixing stateful I/O into `translateEvent` violates SRP. The engine subscriber is the right layer for session-coupled logic.

### Decision 4: `contextWindow` cached in a Map after first turn
**Chosen:** `PiEngine` maintains `Map<qualifiedModelId, contextWindow>` updated on each `turn_end`, exposed in `listModels()`.
**Alternative:** Fetch context window from the LLM provider's `/models` endpoint response.
**Rationale:** The OpenAI-compatible `/models` endpoint does not consistently expose `context_length` across providers (LM Studio and Ollama differ). Pi SDK already knows the real value at runtime and returns it in `getContextUsage()`. Using the live SDK value is more accurate than parsing metadata from provider endpoints.

### Decision 5: `event-translator.ts` imports `AgentSessionEvent` instead of `AgentEvent`
**Chosen:** Change the import from `@earendil-works/pi-agent-core`'s `AgentEvent` to `@earendil-works/pi-coding-agent`'s `AgentSessionEvent`.
**Rationale:** `AgentSessionEvent` is a superset of `AgentEvent` that includes `compaction_start`, `compaction_end`, `queue_update`, etc. The translator already receives `AgentSessionEvent` at runtime (cast to `any`) — the type change just makes this correct. `session.subscribe()` emits `AgentSessionEvent`, not `AgentEvent`.

## Risks / Trade-offs

- **Manual compact outside active execution drops events**: When `compact()` is called while no execution is running (no queue subscriber), Pi SDK emits `compaction_start`/`compaction_end` but the queue doesn't exist. The session JSONL is still compacted — context is reduced — but the UI won't show the compaction lifecycle. → *Mitigation: Acceptable limitation. The next execution starts with smaller context. A future enhancement could persist a `compaction_summary` message directly for these cases.*

- **No context gauge until first turn**: `getContextUsage()` returns `undefined` before the first LLM response. The gauge will be hidden or show 0 until then. → *Mitigation: Consistent with the existing spec which hides the gauge when context window is unknown.*

- **Pi SDK compaction quality depends on local model**: Pi uses the local LLM for summarization, which may produce lower-quality summaries than Claude/GPT-4. → *Accepted trade-off given the decision to keep everything local.*

- **`HarnessContext` interface narrows**: `hashCache` is removed from `HarnessContext`. Any external code referencing `harnessCtx.hashCache` will fail to compile. → *Mitigation: All callsites are in the `tools/` directory, enumerated during exploration. No external dependencies.*

## Migration Plan

1. Delete `hash-cache.ts`, clean up all callsites in tools (`read.ts`, `search.ts`, `write.ts`, `undo.ts`)
2. Remove `hashCache` from `HarnessContext` interface and `getOrCreateHarnessContext()`
3. Update `event-translator.ts`: change import type, add compaction event cases
4. Update `PiEngine.compact()`: call `session.compact()` if session exists
5. Update `PiEngine` subscriber: handle `turn_end` for usage emission and contextWindow caching
6. Update `PiEngine.listModels()`: include `contextWindow` and `supportsManualCompact: true`

No DB migrations, no API changes, no frontend changes. Fully backward-compatible — existing Pi sessions continue working.

## Open Questions

None — all decisions were resolved during exploration.
