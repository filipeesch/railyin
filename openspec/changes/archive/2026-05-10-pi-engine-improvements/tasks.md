## 1. Remove ContentHashCache

- [x] 1.1 Delete `src/bun/engine/pi/harness/hash-cache.ts`
- [x] 1.2 Remove `hashCache` field from `HarnessContext` interface in `src/bun/engine/pi/harness/context.ts`
- [x] 1.3 Remove `hashCache` construction and `ContentHashCache` import from `PiEngine.getOrCreateHarnessContext()` in `engine.ts`
- [x] 1.4 Remove all `hashCache.checkFile`, `hashCache.updateFile`, `hashCache.checkSearch`, `hashCache.updateSearch` calls from `src/bun/engine/pi/tools/read.ts`
- [x] 1.5 Remove all `hashCache.checkSearch`, `hashCache.updateSearch` calls from `src/bun/engine/pi/tools/search.ts`; remove the `ContentHashCache` import
- [x] 1.6 Remove all `hashCache.invalidate()` calls from `src/bun/engine/pi/tools/write.ts`
- [x] 1.7 Remove all `hashCache.invalidate()` calls from `src/bun/engine/pi/tools/undo.ts`

## 2. Wire Pi SDK Compaction

- [x] 2.1 Update `src/bun/engine/pi/event-translator.ts`: change import from `AgentEvent` (`@earendil-works/pi-agent-core`) to `AgentSessionEvent` (`@earendil-works/pi-coding-agent`)
- [x] 2.2 Add `compaction_start` case to `translateEvent`: return `[{ type: "compaction_start" }]`
- [x] 2.3 Add `compaction_end` case to `translateEvent`: return `[{ type: "compaction_done" }]` when `event.aborted === false`, else `[]`
- [x] 2.4 Replace `PiEngine.compact()` body in `engine.ts`: call `session.compact()` on the active session for `conversationId`; no-op if no session exists
- [x] 2.5 Update `listModels()` in `engine.ts` to include `supportsManualCompact: true` on all returned `EngineModelInfo` entries

## 3. Emit Context Usage from turn_end

- [x] 3.1 Add `private readonly modelContextWindows = new Map<string, number>()` to `PiEngine` — superseded: contextWindow comes from `/models` endpoint in `listModels()`
- [x] 3.2 In `createManagedExecution`, capture `currentModelQualifiedId` from the model built before subscribing — not needed with simplified approach
- [x] 3.3 In the `session.subscribe()` callback in `createManagedExecution`, add handling for `turn_end`: call `session.getContextUsage()`, and if `usage.tokens != null` push `{ type: "usage", inputTokens: usage.tokens, outputTokens: 0 }` to the queue
- [x] 3.4 Update `listModels()` to include `contextWindow` — already done via `context_length` from provider `/models` endpoint

## 4. Update Spec Delta Files

- [x] 4.1 Verify `openspec/changes/pi-engine-improvements/specs/content-hash-cache/spec.md` covers all removed requirements
- [x] 4.2 Verify `openspec/changes/pi-engine-improvements/specs/pi-engine/spec.md` covers modified event translation and new compaction/listModels requirements
- [x] 4.3 Verify `openspec/changes/pi-engine-improvements/specs/pi-context-usage/spec.md` covers the new capability correctly
