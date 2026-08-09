# Phase 2: AG-UI Bridge & RailyinAgentRunner - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the **keystone of the migration**: a single AG-UI boundary through which all five engines stream, backed by a custom `RailyinAgentRunner` that persists conversations per-thread as JSONL with replay, run locking, and a complete tool-call lifecycle. Concretely: `RailyinAgent` (AbstractAgent subclass) bridges `RunAgentInput` → orchestrator → `EngineEvent` → AG-UI `BaseEvent`; `RailyinAgentRunner` (InMemoryAgentRunner subclass) persists events to `data/threads/{threadId}.jsonl` and re-hydrates on connect. Deliberately NOT in scope: decision interrupts (Phase 3, RUNR-08), thread-index endpoint (Phase 4, CHAT-08), any UI (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Bridge Architecture (where the translation lives)
- **D-01:** The bridge lives in `RailyinAgent` (extends `AbstractAgent` from `@ag-ui/client`), NOT in the runner. Matches ecosystem semantics (agent = execution, runner = lifecycle/persistence); the base runner's `run()` already wires `agent.runAgent(input, {onEvent})` → live `ReplaySubject` → `connect()` tail-subscription — hijacking `run()` forfeits that machinery. — **Reversibility:** costly — moving translation later touches the runner contract; architecture is research-backed (ARCHITECTURE.md).
- **D-02:** Translation is a pure module `event-bridge.ts` (`EngineEvent` → `BaseEvent`), unit-testable with no I/O — exactly one translation path (BRDG-01, no double-broadcast; the Claude `markClaudeExecution` hack disappears).
- **D-03:** Event mapping (from research): `token` → `TEXT_MESSAGE_CONTENT` (via chunk events), `reasoning` → `REASONING_*`, `tool_start` → `TOOL_CALL_START`, `tool_result` → `TOOL_CALL_RESULT`, `done` → `RUN_FINISHED` (base runner appends), `error` → `RUN_ERROR` (base runner appends on throw). RUN_STARTED must be emitted first (base runner supplements input if absent — verified in Phase 1).

### Runner & Persistence (RailyinAgentRunner)
- **D-04:** `RailyinAgentRunner` extends `InMemoryAgentRunner` — the documented extension pattern (AWS AgentCoreRunner example). Override `run()` (persist, then `super.run`) and `connect()` (re-hydrate from JSONL, then `super.connect`). Known issue #3553: base `connect()` never reaches upstream persistence on cold start — the JSONL re-hydration IS the fix (RUNR-05).
- **D-05:** Persistence is append-only JSONL per thread at `data/threads/{threadId}.jsonl`; replay reads the event log (not snapshots — RUNR-05). JSONL store is a separate pure-ish module `jsonl-store.ts` (no constructor-visible deps). — **Reversibility:** reversible — file format is private to the store.
- **D-06:** Thread mapping (RUNR-03): `threadId = conversation.id` for card conversations; standalone sessions are threads without a taskId. Locked in PROJECT.md.
- **D-07:** connect on a never-run thread returns a valid empty conversation snapshot, not an error (RUNR-06) — verified contract in Phase 1.

### Run Lifecycle Semantics
- **D-08:** Run locking (RUNR-04): a second concurrent run on the same thread is rejected — throw "Thread already running" (base runner contract; surfaces as 500 over SSE; clients busy-guard).
- **D-09:** Replayed tool calls synthesize `TOOL_CALL_RESULT` events so cards never show stale "running" state (RUNR-07) — research PITFALLS.md; engines that batch results need synthetic results on replay.
- **D-10:** Engine selection stays config-driven per workspace: the agent resolves the engine via the existing `EngineRegistry` + `allowed_engines` + model resolver (no hardcoded engine logic).

### Code Location & Shape
- **D-11:** New directory `src/bun/copilotkit/` holding: `railyin-agent.ts` (AbstractAgent subclass), `event-bridge.ts` (pure translation), `railyin-runner.ts` (runner subclass), `jsonl-store.ts` (persistence). One additive directory keeps the ~800–1000 new lines reviewable, delete-able for rollback, and testable in isolation. — **Reversibility:** reversible — additive module.
- **D-12:** The runtime registration in `src/bun/index.ts` switches from the spike's probe `ScriptedAgent` to `RailyinAgent` + `RailyinAgentRunner`; the `RAILYN_COPILOTKIT_PROBE` env gate stays for e2e probe tests.

### the agent's Discretion
- Exact JSONL line schema (event JSON per line; metadata headers if needed).
- Replay ordering/compaction details (use `compactEvents` where applicable).
- How the agent calls the orchestrator (which executor entry point per run type — transition/chat) — planner maps `RunAgentInput` to the existing `ExecutionCoordinator` surface.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (produced this project)
- `.planning/research/ARCHITECTURE.md` — 3-layer shape, bridge-in-agent rationale, event mapping table (lines 89-116), custom-runner extension pattern (#3553 connect issue), `src/bun/copilotkit/` layout proposal (lines 133-156).
- `.planning/research/PITFALLS.md` — replay TOOL_CALL_RESULT synthesis, run-locking SSE error surface, connect-before-run contract.
- `.planning/research/STACK.md` — `@ag-ui/client` AbstractAgent/RunAgentInput/Message types; AgentRunner Observable<BaseEvent> contract; rxjs version pin.
- `.planning/research/FEATURES.md` — thread mapping, JSONL persistence scope, anti-features.
- `.planning/research/SUMMARY.md` — Phase 2 = "AG-UI Bridge & RailyinAgentRunner" (risky bespoke core — build first, test most).

### Project documents
- `.planning/PROJECT.md` — Core value, thread = conversation decision, JSONL storage constraint, Phase 1 spike evidence.
- `.planning/REQUIREMENTS.md` — BRDG-01..03, RUNR-01..07 (this phase).
- `.planning/ROADMAP.md` §Phase 2 — 5 success criteria.

### Codebase (integration points)
- `src/bun/engine/types.ts` — `ExecutionEngine` interface, `EngineEvent` union (line 20), `ExecutionParams`.
- `src/bun/engine/engine-registry.ts` — `EngineRegistry` (engineId → engine, allowed_engines, default fallback).
- `src/bun/engine/orchestrator.ts` — `ExecutionCoordinator` interface: `executeTransition`, `executeChatTurn`, cancel, etc. — the agent's call surface.
- `src/bun/index.ts` — composition root; runtime registration point (Phase 1 mount at lines 242-281).
- `src/bun/testing/mock-engine.ts` — scripted engine pattern for tests.
- `e2e/api/copilotkit/probe-agent.ts` — Phase 1 probe ScriptedAgent (the agent shape to emulate).
- `.planning/phases/01-copilotruntime-hosting-thread-apis-spike/01-CONTEXT.md` — Phase 1 locked decisions D-01..D-10.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/bun/testing/mock-engine.ts`: scripted `ExecutionEngine` producing deterministic `EngineEvent` streams — the test double for bridge contract tests.
- `src/bun/engine/orchestrator.ts`: `ExecutionCoordinator` (executeTransition/executeChatTurn/cancel) — the agent's execution call surface, already unit-tested with fake engines.
- `src/bun/engine/engine-registry.ts`: engine resolution with allowed_engines filtering — reuse as-is.
- `e2e/api/copilotkit/probe-agent.ts`: Phase 1's ScriptedAgent — template for RailyinAgent's structure (RUN_STARTED-first, runAgent).
- `e2e/api/copilotkit/copilotkit.test.ts` + `mock-agui.ts` (Phase 1): validated probe/fixture foundation for extension.

### Established Patterns
- Constructor injection + composition-root wiring (`src/bun/index.ts`) with late-binding for circular deps.
- Pure translation modules with co-located vitest unit tests (e.g., `src/bun/engine/dialects/`).
- Config-driven behavior: workspace/engine config in YAML, per-workspace via AsyncLocalStorage (`runWithConfig`).
- E2E discipline: API tests spawn real server (`e2e/api/fixtures/server.ts`), UI tests mock everything.

### Integration Points
- `src/bun/index.ts` — replace `ScriptedAgent` registration with `RailyinAgent` + `RailyinAgentRunner` in the CopilotRuntime mount.
- `src/bun/engine/orchestrator.ts` — the agent calls into `ExecutionCoordinator` (transition vs chat turns).
- `data/threads/` — new JSONL storage dir (under data dir; check `RAILYN_DATA_DIR` handling).
- `.planning/STATE.md`/ROADMAP — phase tracking.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 1: "exactly one translation path, no double-broadcast" — the event-bridge is THE single path; no parallel WS broadcast for chat.
- Success criterion 3: reload/reconnect mid-run replays from the JSONL event log with no stale "running" tool cards (D-09 synthesis).
- Success criterion 5: "Starting a second concurrent run on the same thread is rejected with a clear error" (D-08).
- Keep the Phase 1 probe (`RAILYN_COPILOTKIT_PROBE`) tests passing while the real agent replaces the ScriptedAgent.

</specifics>

<deferred>
## Deferred Ideas

- Decision interrupts & resume (decision_request → RUN_FINISHED outcome interrupt + RunAgentInput.resume) — Phase 3 (RUNR-08).
- Own thread-index endpoint (`GET /api/threads` list) — Phase 4 (CHAT-08); Phase 1 proved runtime local fallback exists (`runner.listThreads()`, threadEndpoints.list) — verify reuse vs own endpoint.
- Cancel hardening per-engine (labeled "stopped") — v2 (CHAT-11).
- Regenerate/retry via JSONL replay — v2 (CHAT-10).

</deferred>

---

*Phase: 2-AG-UI Bridge & RailyinAgentRunner*
*Context gathered: 2026-08-09*
