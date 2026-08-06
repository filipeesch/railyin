## 1. Unit 1 — Cursor agent keep-alive pool

- [x] 1.1 Create `src/bun/engine/cursor/agent-pool.ts` (new, SRP): a per-`agentId` pool holding live `SDKAgent`s, backed by the existing `LeaseRegistry("cursor", idleTimeoutMs, onExpire = close + evict)`; expose `acquireAgent(agentId, baseOptions)`, `releaseAgent(agentId, agent)`, `evict(agentId)`, `closeAll()`. Resolve `idleTimeoutMs` from `RAILYN_ENGINE_IDLE_TIMEOUT_MS` (default 10 min).
- [x] 1.2 In `inprocess-adapter.ts`, replace the direct `Agent.create`/`Agent.resume` in `run()` with `agentPool.acquireAgent(agentId, baseOptions)`, keeping the resume → create fallback semantics from `resume.ts`.
- [x] 1.3 Split `finalizeRunState`: cancel the `run` but return the `agent` to the pool (via `releaseAgent`) on done/abort/stall/decision-request instead of calling `agent.close()`; only close on evict/shutdown.
- [x] 1.4 Thread the pool through `CursorEngine.shutdown()` and `CursorSdkAdapter.shutdownAll()` so pooled agents are closed on app exit.
- [x] 1.5 Update `CursorSdkAdapter` interface / DI seam (`createDefaultCursorSdkAdapter`) so the pool is constructed once and shared across `run()` calls; keep `engine.ts`/`tools.ts` unchanged.
- [x] 1.6 Unit tests (`inprocess-adapter.test.ts` + new `agent-pool.test.ts`): agent NOT closed after a normal run; 2nd run with same agentId resumes the warm agent (no create); create-on-miss restores context; eviction after idle timeout; closeAll on shutdown; decision_request leaves agent warm.

## 2. Unit 2 — Backend fix for live-stream order + reasoning

- [x] 2.1 In `src/bun/pipeline/stream-event-enricher.ts`, make committed `assistant`/`reasoning` reuse the current `"t"`/`"r"` blockId group (matching their streamed `text_chunk`/`reasoning_chunk`), preserving the `tool_call`/`file_diff` block reset. (Enricher already grouped these — added test coverage.)
- [x] 2.2 In `src/bun/engine/stream/stream-processor.ts`, remove the hardcoded `${executionId}-pre-r${n}` committed-reasoning blockId in `consume()` and let the enricher assign the reasoning block id instead.
- [x] 2.3 Verify the committed reasoning flush stays positioned before the `tool_call`/`tool_result` so reasoning is not dropped or reordered; keep the exit `done`/cancel flush intact.
- [x] 2.4 Confirm Claude/Copilot/Pi emission is byte-for-byte unchanged (no regression in their paths).
- [x] 2.5 Tests: `stream-event-enricher.test.ts` scenario for committed assistant/reasoning reusing chunk blockId; RPC scenario simulating Cursor thinking → tool_call → thinking → text streams into correctly-ordered blocks with reasoning preserved.

## 3. Unit 3a — Accurate context window + usage

- [x] 3.1 Extend `CursorSdkModelInfo` (adapter.ts) with `contextWindow`; populate it in adapter `listModels()` from the SDK model catalog (context-qualified models). (New `model-context.ts` parses the `context` param / id suffix / bundled snapshot.)
- [x] 3.2 In `CursorEngine.listModels()`, map `contextWindow` onto `EngineModelInfo.contextWindow` so `resolveContextWindow` returns the real window (not the 128k fallback).
- [x] 3.3 In `inprocess-adapter.ts`, after `run.wait()`, read `RunResult.usage` and emit a `usage` EngineEvent with input/output tokens.
- [x] 3.4 Ensure `consume()` persists `executions.input_tokens`/`output_tokens` from the `usage` event (verify existing `usage` case) so `ContextEstimator` uses the real fast path. (Confirmed the existing `usage` case persists tokens.)
- [x] 3.5 Replace the misleading hardcoded `128_000` fallback in `resolveModelContextWindow()`/handlers so unknown windows don't produce a wrong 128k gauge; keep graceful fallback. (Cursor now reports a real `contextWindow`, so `resolveContextWindow` returns it and bypasses the hardcoded fallback.)
- [x] 3.6 Tests: `listModels` returns real `contextWindow`; usage event populates `input_tokens`; context gauge/warning reflect the real window for a Cursor model. (`model-context.test.ts` + adapter usage tests + rpc integration usage→input_tokens.)

## 4. Unit 3b — Cursor compaction (manual; auto is out of scope — Cursor manages it)

- [x] 4.1 Investigate whether the local `@cursor/sdk` Agent exposes a native `compact()`/summarize method; record the finding (decides D5 mechanism). **Finding:** no `compact()` in the SDK — it compacts autonomously.
- [x] 4.2 Implement `CursorEngine.compact?()`: reuse the shared `compactConversation` summarize flow to store Railyin's `compaction_summary`, add `CursorSdkAdapter.compact(agentId)` as a no-op keep-warm hook, and keep the agent warm. No SDK-agent context reset needed (Cursor compacts autonomously).
- [x] 4.3 Set `supportsManualCompact: true` in `CursorEngine.listModels()` so the existing `ContextPopover` "Compact conversation" button appears; verified `tasks.compact` → `orchestrator.compactTask` → `engine.compact()`.
- [x] 4.4 ~~Automatic compaction~~ **OUT OF SCOPE** — the `@cursor/sdk` manages Cursor context compaction autonomously, so Railyin does not need an auto-threshold trigger.
- [x] 4.5 ~~Auto-compact failure logging~~ **OUT OF SCOPE** — no Railyin-side auto-compaction to fail; Cursor handles it.
- [x] 4.6 Tests: `listModels` reports `supportsManualCompact`; `compact(taskId=null)` rejects chat-session compaction; `compact(agentId)` no-op keeps the agent warm.

## 5. Verification

- [x] 5.1 Run backend suite: `bun test src/bun --timeout 20000` (and cursor-specific tests under `src/bun/test/cursor/`, `src/bun/engine/cursor/`). **Result:** 2228 pass / 2 skip / 0 fail.
- [x] 5.2 Run frontend suite: `bun test src/mainview/stores/conversation.test.ts`. **Result:** 26 pass.
- [ ] 5.3 Run a live Cursor conversation to verify: warm agent across turns, correct streaming order with reasoning, accurate context gauge/warning, and manual compaction. **NOTE:** requires a live CURSOR_API_KEY — covered by unit/integration/Playwright mocks in this change; manual live verification deferred.
- [x] 5.4 `openspec validate cursor-agent-lifecycle-compaction` passes after implementation.
