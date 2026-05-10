## Why

The Pi engine has three functional defects that make it unreliable in practice: (1) the `ContentHashCache` injects misleading "use your cached version" messages that confuse local LLMs which have no prompt cache, (2) auto-compaction silently fails because Pi SDK compaction events are never forwarded to Railyin's event stream and `PiEngine.compact()` does nothing, and (3) the context gauge always shows incorrect usage because Pi never emits token counts and the fallback context window is hardcoded to 128,000 regardless of the actual local model's limit.

## What Changes

- **Remove** `ContentHashCache` from all Pi tools (`read_file`, `glob`, `search_text`) — eliminates confusing short-circuit messages and simplifies `HarnessContext`
- **Remove** `hash-cache.ts` (no remaining callers after tool cleanup)
- **Wire** Pi SDK compaction: `PiEngine.compact()` now calls `session.compact()`; `compaction_start`/`compaction_end` events from `AgentSessionEvent` are translated and forwarded to Railyin's `EngineEvent` stream
- **Emit** a `usage` event after each Pi turn using `session.getContextUsage()`, feeding the existing `ContextEstimator` fast path
- **Expose** `contextWindow` in `listModels()` once a session has completed at least one turn
- **Mark** Pi models as `supportsManualCompact: true` in `listModels()`

## Capabilities

### New Capabilities

- `pi-context-usage`: Pi engine emits real-time context usage (tokens used, context window size) after each turn via the existing `usage` EngineEvent mechanism

### Modified Capabilities

- `content-hash-cache`: The `ContentHashCache` is removed entirely from Pi tools. The spec scenarios describing cache-hit marker messages are no longer valid; the cache is gone.
- `pi-engine`: New compaction wiring (session.compact, event forwarding), usage emission, and contextWindow surfacing in listModels change the Pi engine's runtime behavior.
- `context-gauge`: Pi tasks now receive accurate `usedTokens` and `maxTokens` values after first turn, fixing the display.
- `conversation-compaction`: Pi now participates in the compaction lifecycle. Manual and auto-compaction both work via Pi SDK's built-in `session.compact()`.

## Impact

- **`src/bun/engine/pi/harness/hash-cache.ts`** — deleted
- **`src/bun/engine/pi/harness/context.ts`** — `hashCache` field removed
- **`src/bun/engine/pi/tools/read.ts`** — cache check/update calls removed
- **`src/bun/engine/pi/tools/search.ts`** — cache check/update calls removed
- **`src/bun/engine/pi/tools/write.ts`** — `hashCache.invalidate()` calls removed
- **`src/bun/engine/pi/tools/undo.ts`** — `hashCache.invalidate()` calls removed
- **`src/bun/engine/pi/event-translator.ts`** — import changed from `AgentEvent` to `AgentSessionEvent`; compaction event cases added
- **`src/bun/engine/pi/engine.ts`** — `compact()` implementation replaced; `modelContextWindows` map added; subscriber extended for `turn_end`; `listModels()` updated
- No API surface changes, no DB migrations, no frontend changes
