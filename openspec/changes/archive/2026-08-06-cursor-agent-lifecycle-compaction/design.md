## Context

The Cursor engine runs `@cursor/sdk` in-process in the Bun server. Each run derives a deterministic `agentId` (UUIDv5 from a fixed namespace + `task:${taskId}` or `conversation:${conversationId}`), and the adapter uses `resumeOrCreateAgent` (try `Agent.resume(agentId)` → fall back to `Agent.create({ agentId })`). Because the SDK's local store keys agents by `agentId`, conversation history survives across turns even when the agent object is recreated.

However, the adapter calls `agent.close()` in `finalizeRunState()` after **every** run, so the in-memory agent is torn down and recreated each turn. This is not a conversation-history-loss bug (the store preserves history), but it defeats warm resumption: tools/session state and in-memory context are discarded and re-created, and every turn pays a full agent spin-up instead of a live `Resume`. Copilot solves exactly this by keeping per-task sessions alive in a pool with an idle-timeout lease (`taskCliPool` + `LeaseRegistry`).

Separately:
- The live-stream UI renders everything from `streamState.roots` (persisted messages are held back until `done`). Block ordering depends on `StreamEventEnricher` blockIds and how `consume()` flushes committed `reasoning`/`assistant` events. Cursor-specific committed-reasoning flush uses a hardcoded `${executionId}-pre-r${n}` id that diverges from the enricher's `{executionId}-r{n}`, and a `tool_call` can remove the live reasoning chunk before the committed reasoning lands → shuffled order + lost reasoning.
- Cursor reports no `usage` and no `contextWindow`, so context estimation falls back to a hardcoded 128k window and a crude char/4 estimate. Cursor implements neither manual nor automatic compaction, unlike Claude/Copilot/Pi.

## Goals / Non-Goals

**Goals:**
- Keep a Cursor conversation's agent warm across turns via a pooled, idle-timeout-evicted agent registry (mirrors Copilot), so turns `Resume` a live agent rather than recreating it.
- Fix the Cursor live-stream ordering + reasoning-disappearing bug by aligning committed blockIds with streamed chunk blockIds in the backend pipeline, without touching the frontend store.
- Report accurate Cursor `contextWindow` + per-run `usage` so the console warning and UI gauge reflect the real model context.
- Give the Cursor engine manual compaction (existing UI button) that stores a Railyin `compaction_summary`; the `@cursor/sdk` manages the agent's own context compaction autonomously, so Railyin adds no auto-threshold trigger and no SDK-agent context reset.

**Non-Goals:**
- No change to the frontend `conversation.ts` live-tail store (Unit 2 stays backend-only).
- No new external dependency for the agent pool (reuses `LeaseRegistry`).
- No change to prompt composition, slash-command resolution, or tool schemas.
- No data migration: compaction_summary + conversation_messages schema already exist.
- Do not rearchitect Cursor's `resume()` in-turn path (still throws; fresh execution on human turn remains the contract).

## Decisions

### D1 — Per-agentId pool with idle-timeout eviction, reusing `LeaseRegistry`

Introduce `src/bun/engine/cursor/agent-pool.ts` — a small pool owned by `InProcessCursorAdapter`, keyed by `agentId`, holding the live `SDKAgent` objects. Backed by the existing generic `LeaseRegistry("cursor", idleTimeoutMs, onExpire = close+evict)`, exactly like Copilot's `DefaultCopilotSdkAdapter`.

- **Acquire(agentId, baseOptions)**: touch lease; if a warm agent exists, `Agent.resume(agentId)` reuses it; else `Agent.create({ ...baseOptions, agentId })` (which restores the persisted conversation). Preserves the existing `resumeOrCreateAgent` fallback semantics.
- **Release(agentId)**: after a run ends (done / abort / stall / decision_request), do NOT `close()`. Return the agent to the pool and set the lease idle.
- **Evict(agentId)** (on lease expiry): `agent.close()` + remove from pool.
- **CloseAll()**: on `CursorEngine.shutdown()` / adapter `shutdownAll()`, close + evict every pooled agent.

`idleTimeoutMs` = `Number(process.env.RAILYN_ENGINE_IDLE_TIMEOUT_MS ?? 10 * 60 * 1000)` (same var as Copilot).

**Alternative considered:** keep calling `close()` and rely solely on `Agent.create({ agentId })` restoring persisted history. Rejected — it keeps paying the recreate/spin-up cost each turn and discards warm in-memory tool/session state, which is the exact behavior the user wants to eliminate ("keep the agent alive for a period of time, like Copilot").

### D2 — Keep the abort/stall/decision-request paths pool-safe

`finalizeRunState` currently both cancels the run and closes the agent. Split these:
- Cancel the `run` (unchanged).
- Return the `agent` to the pool instead of closing it, in all terminal paths. Only lease expiry / `CloseAll` closes agents.

This way a `decision_request` (which aborts the run so the model cuts) still leaves the agent warm, and the next turn resumes it with intact context — directly improving the reasoning/continuity experience.

### D3 — Backend-only fix for committed blockId alignment (Unit 2)

In `src/bun/pipeline/stream-event-enricher.ts` and `src/bun/engine/stream/stream-processor.ts`:

- Make committed `reasoning` and `assistant` events reuse the same enricher blockId as their streamed `reasoning_chunk`/`text_chunk` counterparts, so the frontend replaces the live chunk block cleanly instead of inserting a divergent-id block at the wrong position.
- Remove the hardcoded `${executionId}-pre-r${n}` reasoning block in `consume()`'s `tool_start` flush; let the enricher assign the reason block id.
- Ensure the committed reasoning flush happens at the same scope/position relative to the `tool_call` (flush reasoning before the tool event, as it already does), so the block is inserted where the reasoning chunk was, not appended at the end.

Because the issue is Cursor-specific (chunk + committed events share one enricher path and same `onStreamEvent` emission for Cursor, unlike Claude's `claudeExecutionIds` path), scope the changes so Claude/Copilot/Pi emission is byte-for-byte unchanged. Add a targeted regression test simulating the Cursor thinking → tool_call → thinking → text sequence.

### D4 — Report real `contextWindow` and per-run `usage` (Unit 3a)

- **contextWindow**: extend `CursorSdkModelInfo` with `contextWindow` (from the SDK model catalog — Cursor models are context-qualified, e.g. `claude-opus-4-8@300k`, `gpt-5.5@272k`). Populate `EngineModelInfo.contextWindow` in `CursorEngine.listModels()`, so `resolveContextWindow` (which already prefers `listModels().contextWindow`) returns the real window instead of falling through to the hardcoded 128k.
- **usage**: after `run.wait()`, read `RunResult.usage` (input/output tokens) and emit a `usage` EngineEvent so `consume()` persists `executions.input_tokens`/`output_tokens`, giving `ContextEstimator` a real fast path instead of the char/4 heuristic.
- Remove/replace the misleading hardcoded `128_000` fallback in `resolveModelContextWindow()` (used only when no engine contextWindow is known).

### D5 — Cursor compaction: manual only, reusing the shared summary flow (Unit 3b)

- Implement `CursorEngine.compact?()`: reuse the shared `compactConversation`/`compactMessages` summarize-and-recreate flow to persist a Railyin `compaction_summary` (which future Railyin-side context estimation and prompt assembly use). Add `CursorSdkAdapter.compact(agentId)` as a no-op keep-warm hook. Set `supportsManualCompact: true` in `listModels()` so the existing `ContextPopover` "Compact conversation" button appears (wired via `orchestrator.compactTask`/`compactConversation`).
- **Mechanism**: the local `@cursor/sdk` exposes no native `compact()` (confirmed by inspecting its type surface), and it manages the agent's own context compaction autonomously. So Railyin does NOT reset/recreate the SDK agent, and does NOT implement a Railyin-side auto-threshold trigger.
- No `compaction_start`/`compaction_done` stream events are required for the manual Cursor path — the UI feedback is the orchestrator's `message.new` broadcast of the `compaction_summary` divider plus the button's `compacting` state.

**Alternative considered:** Railyin-side auto-threshold compaction + SDK-agent context reset. Rejected per user decision: the `@cursor/sdk` compacts the agent's context autonomously, so neither is needed.

## Risks / Trade-offs

- **[Risk] Keeping agents open increases memory/process footprint** → Mitigation: bounded by `RAILYN_ENGINE_IDLE_TIMEOUT_MS` idle eviction + `CloseAll` on shutdown, mirroring Copilot; default 10 min is conservative.
- **[Risk] Resume of a warm agent may require matching `local` options (cwd/model/settings)** → Mitigation: pool keyed by `agentId` (already conversation-deterministic) and acquire passes the same `baseOptions` (cwd, model, customTools, settingSources) as Copilot does; on any resume mismatch the existing create fallback restores from the local store.
- **[Risk] Enricher/consume change could regress Claude/Copilot/Pi offsets** → Mitigation: scope the blockId change to reasoning/assistant committed alignment and verify with the existing enricher + engine-stream-processor tests; keep non-Cursor emission paths untouched and run the full backend suite.
- **[Risk] Auto-compaction could race an in-flight run or evict an active agent** → Mitigation: only trigger auto-compact between executions, when no run is active for the conversation; acquire the agent through the pool lease (touch before, idle after) and skip if already compacting.
- **[Risk] SDK `compact()` may not exist** → Mitigation: the decision explicitly allows falling back to the proven `compactConversation`/`compactMessages` flow, which reuses existing schema/UI/injection.

## Migration Plan

1. Land Unit 1 (agent pool) — backend only, low risk; existing tests should pass with a `close()`-count assertion change.
2. Land Unit 2 (enricher/consume blockId alignment) — independent; re-run enricher + stream-processor + Cursor rendering tests.
3. Land Unit 3a (contextWindow + usage) — verify gauge/warning now reflect real window.
4. Land Unit 3b (compaction) — manual button first, then automatic trigger; verify with a long conversation.

**Rollback:** each unit is independently revertable via `git revert`; no data migration or schema change, so rollback is a clean source revert.

## Open Questions

- Exact Cursor SDK model-catalog shape for `contextWindow` (verify against SDK types / a real run).
- Whether `Agent.resume` on a warm in-memory agent is the intended acquire path vs. only the persisted store, and whether the local agent exposes a native `compact()` (decides D5 mechanism).
- Whether `RunResult.usage` is always populated for local agents; if absent, keep the char/4 heuristic as a fallback but with a correct contextWindow.
