## Why

Cursor conversations suffer from three coupled problems:

1. **The Cursor agent is torn down and recreated every turn.** `InProcessCursorAdapter.finalizeRunState()` calls `agent.close()` at the end of every run. Even though a deterministic `agentId` is derived and `Agent.resume(agentId)` / `Agent.create({ agentId })` restore the persisted conversation from the SDK local store, the in-memory agent object/process is recreated each turn — losing warm state and paying per-turn spin-up cost, instead of resuming a live agent the way Copilot keeps sessions warm.
2. **Live-streamed messages appear shuffled and reasoning bubbles disappear during streaming.** In `stream-processor.consume()`, the committed-reasoning flush at `tool_start` passes a hardcoded `${executionId}-pre-r${n}` blockId override that diverges from the `StreamEventEnricher`'s `{executionId}-r{n}` reasoning block, so the live-tail rendering reorders/drops reasoning. History loaded from the DB is correct, which confirms the bug is in the live event / blockId pipeline.
3. **Context usage is misreported and Cursor has no compaction.** Cursor never emits `usage` events and `listModels()` reports no `contextWindow`, so the console warning and UI gauge fall back to a hardcoded 128k window and a crude char/4 estimate (e.g. "2215% of model limit"). The Cursor engine implements neither manual nor automatic compaction, so long conversations cannot reclaim context window the way Claude, Copilot, and Pi can.

## What Changes

### Unit 1 — Keep the Cursor agent alive across turns
- Introduce a per-`agentId` agent pool inside the Cursor adapter, backed by the existing generic `LeaseRegistry`, mirroring the Copilot `taskCliPool`.
- Stop calling `agent.close()` after every run; instead return the agent to the pool and keep it warm.
- Evict + close idle agents via the lease idle-timeout (env `RAILYN_ENGINE_IDLE_TIMEOUT_MS`, default 10 min); close all pooled agents on engine `shutdown()`.
- On a new run, acquire the agent from the pool (resume a warm agent, or create/restore by `agentId`), preserving the existing resume → create fallback.

### Unit 2 — Fix live-stream ordering and disappearing reasoning (backend, simplified)
- Root cause is a **single divergent blockId override**: `consume()`'s `tool_start` committed-reasoning flush uses `${executionId}-pre-r${n}`. The `StreamEventEnricher` already groups committed `reasoning`/`assistant` with their streamed `reasoning_chunk`/`text_chunk` chunks, and every other reasoning flush uses `blockId: ""` (enricher-assigned) correctly.
- Fix: **remove the `pre-r` override** so committed reasoning reuses the enricher's reasoning blockId, and **delete the now-dead `reasoningBlockId` / `reasoningFlushCount` accumulators** (dead code — `reasoningBlockId` is set but never read).
- Scope to the Cursor/`consume()` path; do not regress Claude/Copilot/Pi behavior (their flushes already use `blockId: ""`).

### Unit 3 — Accurate context reporting + Cursor compaction
- Expose a real `contextWindow` on Cursor `listModels()` from the SDK model catalog, and emit real per-run `usage`/`input_tokens` from `RunResult.usage`.
- Fixes the misleading console context warning and the UI gauge (no more fake 128k / 2215%).
- Implement manual compaction for the Cursor engine: `ExecutionEngine.compact?()`, set `supportsManualCompact: true` so the existing "Compact conversation" button appears, plus `compaction_start`/`compaction_done` events and the `compaction_summary` message.
- **Compaction reach (decision #1851):** extend the `CursorSdkAdapter` interface with `compact(agentId)`; `CursorEngine.compact()` derives the `agentId` and delegates to the adapter, which triggers compaction on the pooled/warm agent (native SDK compact if present, else the summarize-and-recreate flow).
- **Auto-compact trigger (decision #1852):** engine-level, mirroring Pi — after a Cursor execution completes, if estimated context usage crosses the threshold (~80%), trigger compaction with safeguards against racing an in-flight run or evicting an active pooled agent.
- Mechanism: investigate a native SDK `compact()` first; if none exists, reuse the existing `compactConversation`/`compactMessages` summarize-and-recreate flow.

## Capabilities

### New Capabilities
- `cursor-agent-keepalive`: Cursor agent pooling + idle-timeout eviction so a conversation's Cursor agent stays warm across turns.
- `cursor-compaction`: Manual + automatic context compaction for the Cursor engine, including `compact()` (via the adapter), `supportsManualCompact`, compaction lifecycle events, and the compaction summary message.

### Modified Capabilities
- `cursor-sdk`: Extend the per-conversation agent lifecycle to keep the agent warm via a pool; add a `compact(agentId)` adapter capability; extend `listModels` to expose a real `contextWindow`; and report per-run token `usage`.
- `stream-event-enricher`: (Minimal — already groups committed `reasoning`/`assistant` with their streamed chunks) add spec coverage for that alignment.
- `engine-stream-processor`: Remove the divergent `pre-r` committed-reasoning blockId override in `consume()`.

## Impact

- **Code**
  - `src/bun/engine/cursor/inprocess-adapter.ts` — agent pool acquisition/release, stop per-run close, `compact(agentId)`, real usage from `RunResult.usage`.
  - New `src/bun/engine/cursor/agent-pool.ts` — pooled agent lifecycle (SRP).
  - `src/bun/engine/cursor/engine.ts` — `shutdown()` → close pool; `compact()` (delegates to adapter); engine-level auto-compact; `listModels()` contextWindow.
  - `src/bun/engine/cursor/adapter.ts` — `CursorSdkAdapter.compact(agentId)`; model-info `contextWindow`; `usage` type.
  - `src/bun/engine/cursor/resume.ts` / `recovery.ts` — pool-aware acquire.
  - `src/bun/engine/cursor/translate-events.ts` — optional usage event translation if surfaced by SDK.
  - `src/bun/engine/stream/stream-processor.ts` — remove the `pre-r` override + dead accumulators.
  - `src/bun/conversation/context.ts` / `context-estimator.ts` — rely on real input_tokens + contextWindow; avoid misleading hardcoded 128k fallback.
- **OpenSpec specs modified**: `cursor-sdk`, `stream-event-enricher`, `engine-stream-processor`.
- **New OpenSpec specs**: `cursor-agent-keepalive`, `cursor-compaction`.
- **Env/config**: `RAILYN_ENGINE_IDLE_TIMEOUT_MS` for the Cursor pool idle timeout (reuses Copilot's var) and an auto-compact threshold.
- **Tests**: extend `inprocess-adapter.test.ts`, `engine.test.ts`, `translate-events.test.ts`, `stream-event-enricher.test.ts`, `stream-processor` tests, `cursor.spec.ts` / `compact-button.spec.ts` (Playwright), add agent-pool + compaction coverage; update existing close-per-run assertions (see Testing).

## Testing (aligned scenarios)

All tests use **dependency injection** for mocks (fake SDK client, `MockCursorSdkAdapter`, injected pool/`LeaseRegistry`, injected context/model resolution) rather than alternative mock paths.

### Unit 1 — keep-alive pool
- **Unit (`agent-pool.test.ts` + updated `inprocess-adapter.test.ts`, injected pool/lease):**
  - Acquire warm agent → `Agent.resume` reused, no `create`; create-on-miss restores context via `Agent.create({ agentId })`.
  - Release returns the agent to the pool — `agent.close()` NOT called on normal done, cancel, stall, or `decision_request`.
  - Idle-timeout evicts + closes; `CloseAll`/`shutdown` closes all pooled agents.
  - **Update existing assertions** in `inprocess-adapter.test.ts` that currently assert `agent.close` IS called after a run (keep-alive reverses this → assert NOT closed, returned to pool).
- **Integration (`cursor-rpc-runtime` in-memory DB):** two consecutive turns on the same task reuse the same warm agent (assert via adapter trace / pool state).

### Unit 2 — streaming order + reasoning
- **Unit (`stream-event-enricher.test.ts`):** committed `reasoning` reuses the `reasoning_chunk` blockId; committed `assistant` reuses the `text_chunk` blockId (after tool_call reset).
- **Unit/Integration (`stream-processor` tests + `cursor-rpc-runtime`):** simulate Cursor thinking → tool_call → thinking → text; assert emitted IPC events are ordered with reasoning preserved and no `pre-r` blockId.
- **Playwright (`cursor.spec.ts` extension):** push a `reasoning_chunk`/`text_chunk`/`tool_call` WS event sequence; assert the rendered chat order and that the reasoning bubble stays visible during streaming.

### Unit 3a — usage + context window
- **Unit:** `CursorSdkAdapter.listModels` returns real `contextWindow`; adapter emits a `usage` event from `RunResult.usage`.
- **Integration:** `usage` event → `executions.input_tokens` persisted; `resolveContextWindow` uses Cursor `listModels().contextWindow`.
- **Playwright:** context gauge shows the real Cursor window (not 128k).

### Unit 3b — compaction (mirror `pi-engine.test.ts` PE-COMPACT DI pattern)
- **Unit:** `CursorEngine.compact()` delegates to `adapter.compact(agentId)`; `supportsManualCompact: true` in `listModels`; engine-level auto-compact fires above the threshold, skipped below / while running / while compacting, and failure is logged only.
- **Integration:** `tasks.compact` on a Cursor task → `compaction_summary` persisted + `message.new` broadcast + `compaction_start`/`compaction_done` stream events.
- **Playwright:** `compact-button.spec.ts` extension — compact button is visible for a Cursor model with `supportsManualCompact`; clicking triggers compaction.
