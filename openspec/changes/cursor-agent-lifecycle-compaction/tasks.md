## 1. Unit 1 — Cursor agent keep-alive pool

- [ ] 1.1 Create `src/bun/engine/cursor/agent-pool.ts` (new, SRP): a per-`agentId` pool holding live `SDKAgent`s, backed by the existing `LeaseRegistry("cursor", idleTimeoutMs, onExpire = close + evict)`; expose `acquireAgent(agentId, baseOptions)`, `releaseAgent(agentId, agent)`, `evict(agentId)`, `closeAll()`. Resolve `idleTimeoutMs` from `RAILYN_ENGINE_IDLE_TIMEOUT_MS` (default 10 min).
- [ ] 1.2 In `inprocess-adapter.ts`, replace the direct `Agent.create`/`Agent.resume` in `run()` with `agentPool.acquireAgent(agentId, baseOptions)`, keeping the resume → create fallback semantics from `resume.ts`.
- [ ] 1.3 Split `finalizeRunState`: cancel the `run` but return the `agent` to the pool (via `releaseAgent`) on done/abort/stall/decision-request instead of calling `agent.close()`; only close on evict/shutdown.
- [ ] 1.4 Thread the pool through `CursorEngine.shutdown()` and `CursorSdkAdapter.shutdownAll()` so pooled agents are closed on app exit.
- [ ] 1.5 Update `CursorSdkAdapter` interface / DI seam (`createDefaultCursorSdkAdapter`) so the pool is constructed once and shared across `run()` calls; keep `engine.ts`/`tools.ts` unchanged.
- [ ] 1.6 Unit tests (`inprocess-adapter.test.ts` + new `agent-pool.test.ts`): agent NOT closed after a normal run; 2nd run with same agentId resumes the warm agent (no create); create-on-miss restores context; eviction after idle timeout; closeAll on shutdown; decision_request leaves agent warm.

## 2. Unit 2 — Backend fix for live-stream order + reasoning

- [ ] 2.1 In `src/bun/pipeline/stream-event-enricher.ts`, make committed `assistant`/`reasoning` reuse the current `"t"`/`"r"` blockId group (matching their streamed `text_chunk`/`reasoning_chunk`), preserving the `tool_call`/`file_diff` block reset.
- [ ] 2.2 In `src/bun/engine/stream/stream-processor.ts`, remove the hardcoded `${executionId}-pre-r${n}` committed-reasoning blockId in `consume()` and let the enricher assign the reasoning block id instead.
- [ ] 2.3 Verify the committed reasoning flush stays positioned before the `tool_call`/`tool_result` so reasoning is not dropped or reordered; keep the exit `done`/cancel flush intact.
- [ ] 2.4 Confirm Claude/Copilot/Pi emission is byte-for-byte unchanged (no regression in their paths).
- [ ] 2.5 Tests: `stream-event-enricher.test.ts` scenario for committed assistant/reasoning reusing chunk blockId; `translate-events`/RPC scenario simulating Cursor thinking → tool_call → thinking → text streams into correctly-ordered blocks with reasoning preserved.

## 3. Unit 3a — Accurate context window + usage

- [ ] 3.1 Extend `CursorSdkModelInfo` (adapter.ts) with `contextWindow`; populate it in adapter `listModels()` from the SDK model catalog (context-qualified models).
- [ ] 3.2 In `CursorEngine.listModels()`, map `contextWindow` onto `EngineModelInfo.contextWindow` so `resolveContextWindow` returns the real window (not the 128k fallback).
- [ ] 3.3 In `inprocess-adapter.ts`, after `run.wait()`, read `RunResult.usage` and emit a `usage` EngineEvent with input/output tokens.
- [ ] 3.4 Ensure `consume()` persists `executions.input_tokens`/`output_tokens` from the `usage` event (verify existing `usage` case) so `ContextEstimator` uses the real fast path.
- [ ] 3.5 Replace the misleading hardcoded `128_000` fallback in `resolveModelContextWindow()`/handlers so unknown windows don't produce a wrong 128k gauge; keep graceful fallback.
- [ ] 3.6 Tests: `listModels` returns real `contextWindow`; usage event populates `input_tokens`; context gauge/warning reflect the real window for a Cursor model.

## 4. Unit 3b — Cursor compaction (manual + auto)

- [ ] 4.1 Investigate whether the local `@cursor/sdk` Agent exposes a native `compact()`/summarize method; record the finding (decides D5 mechanism).
- [ ] 4.2 Implement `CursorEngine.compact?()` mirroring `CopilotEngine.compact()`: resolve the pooled/warm agent, trigger compaction (native if available, else the `compactConversation`/`compactMessages` summarize-and-recreate flow), emit `compaction_start`/`compaction_done`, persist `compaction_summary`, return agent to idle.
- [ ] 4.3 Set `supportsManualCompact: true` in `CursorEngine.listModels()` so the existing `ContextPopover` "Compact conversation" button appears; verify `tasks.compact`/`chatSessions.compact` → `orchestrator.compactTask/compactConversation` → `engine.compact()` works end-to-end.
- [ ] 4.4 Implement automatic compaction: after a Cursor execution completes, if estimated context usage crosses the auto-compact threshold (~80%), trigger compaction — guarded against already-compacting and against racing an in-flight run / evicting an active pooled agent (touch lease).
- [ ] 4.5 Ensure auto-compact failures are logged and not surfaced fatally.
- [ ] 4.6 Tests: manual compact emits lifecycle events + `compaction_summary` + `message.new`; auto-compact fires above threshold, skipped below/skipped while running/compacting; failure is logged only.

## 5. Verification

- [ ] 5.1 Run backend suite: `bun test src/bun --timeout 20000` (and cursor-specific tests under `src/bun/test/cursor/`, `src/bun/engine/cursor/`).
- [ ] 5.2 Run frontend suite: `bun test src/mainview/stores/conversation.test.ts`.
- [ ] 5.3 Run a live Cursor conversation to verify: warm agent across turns, correct streaming order with reasoning, accurate context gauge/warning, and manual + auto compaction.
- [ ] 5.4 `openspec validate cursor-agent-lifecycle-compaction` passes after implementation.
