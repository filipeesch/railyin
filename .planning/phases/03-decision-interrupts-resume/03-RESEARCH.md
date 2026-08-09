# Phase 3: Decision Interrupts & Resume — Research

**Researched:** 2026-08-09
**Domain:** AG-UI canonical interrupt contract (RUN_FINISHED interrupt outcome + RunAgentInput.resume[]) implemented in the Phase 2 bridge (RailyinAgent + RailyinAgentRunner), with fake-engine contract tests
**Confidence:** HIGH (wire contract verified against the INSTALLED packages `@ag-ui/core@0.0.57` / `@copilotkit/runtime@1.66.4` / `@copilotkit/vue@1.66.4` this session, plus official AG-UI docs via Context7; in-repo surfaces read from source)

## Summary

Phase 3 makes `decision_request` the only human-in-the-loop channel via the **canonical AG-UI interrupt protocol**. The work is entirely server-side and test-side: (1) the Phase 2 `RailyinAgent` re-wires its `"decision"` terminal to emit `RUN_FINISHED { outcome: { type: "interrupt", interrupts: [{ id, reason: "decision_request", message, metadata }] } }` — a **normal completion**, never an error; (2) `run()` gains a **resume branch** that accepts `RunAgentInput.resume[]`, validates it against an in-memory per-thread interrupt registry (D-05), translates the payload into the existing decision-submission format, and delivers it through the orchestrator's existing decision path (`executeChatTurn` / `executeHumanTurn`) so the engine's continuation events stream on the resume run — the old "run pauses instead of ending" UX on canonical events; (3) the **pending-interrupt block** (D-04) is mostly already implemented by Phase 2's advisory DB lock (`executions.status IN ('running','waiting_user')` → `THREAD_BUSY`), and the resume branch must **bypass it**; a critical wrinkle discovered this session: a chat-session resume starts a NEW execution and the old `waiting_user` row is **never closed by any existing code path** — without an explicit cleanup step, the advisory lock wedges the thread forever after any decision pause. (4) Contract tests via the mock engine's scripted markers prove the full cycle: events → interrupt outcome → resume → translated decision reaches the engine → continuation → replay.

**Primary recommendation:** emit the interrupt terminal from the **agent's** `finish()` path (terminals stay agent-owned — Pitfall 3), with pure helper functions in `event-bridge.ts` (`buildInterruptOutcome`, `translateResumeToSubmission`) so the wire shapes are unit-testable; put the pending-interrupt registry in a **module-level singleton** (`interrupt-registry.ts`) because the runtime clones the agent per request and instance fields are lost; and make the resume branch run **before** `extractUserText` and **before** the advisory lock in `run()`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Interrupt outcome emission (`decision_request` → RUN_FINISHED interrupt) | API / Backend (RailyinAgent `finish()` + event-bridge helper) | — | The terminal event must stay agent-owned (Pitfall 3 — exactly one terminal per run); the engine event is only visible inside the agent's `onEngineEvent` tap |
| Pending-interrupt blocking (D-04) | API / Backend (agent `run()` + DB advisory lock) | Database / Storage (executions rows) | The durable truth is the `executions.status='waiting_user'` row (survives restarts); the registry adds precise error messages and interruptId validation |
| Resume routing + payload translation (D-07) | API / Backend (agent resume branch → orchestrator) | — | Translation target is the existing decision-submission path (`buildDecisionSubmission` + `executeChatTurn`/`executeHumanTurn`) |
| Interrupt persistence & replay (D-08) | Database / Storage (JSONL per-thread log) | API / Backend (runner cold-replay path) | RUN_FINISHED with interrupt outcome persists like any terminal (verified `compactEvents`/`finalizeRunEvents` preserve it); resume run = new run on the same thread |
| Decision card rendering (`#interrupt` slot, useInterrupt) | Browser / Client | — | Phase 5 (deferred); Phase 3 only guarantees the event/payload contract the card consumes (`{ event, interrupt, interrupts, result, resolve, cancel }` verified in the installed Vue bundle) |

## Standard Stack

### Core

No new packages. The entire phase runs on the pinned stack from Phases 1–2 (asserted by `e2e/api/copilotkit/pins.test.ts`):

| Library | Version | Role in This Phase |
|---------|---------|--------------------|
| `@ag-ui/core` | **0.0.57** (exact pin) | `RunAgentInput.resume[]` schema (verified `dist/index.d.ts:2984-2987`), `Interrupt`/`RunFinishedInterruptOutcome` schemas (verified `:2267-2289`, `:9508-9562`), `EventType` enum |
| `@ag-ui/client` | **0.0.57** (exact pin) | `BaseEvent` typing; `compactEvents`/`getRunOutcome`/`buildResumeArray`/`isInterruptExpired` helpers; `AbstractAgent.pendingInterrupts` (client-side interrupt tracking, Phase 5) |
| `@copilotkit/runtime` | **1.66.4** (`/v2` subpath) | `InMemoryAgentRunner` base (verified `dist/v2/runtime/runner/in-memory.mjs:372` — `agent.runAgent(request.input, …)` passes the FULL input incl. `resume[]` through); `finalizeRunEvents` (verified replay-safe for interrupt terminals) |
| `@copilotkit/vue` | **1.66.4** (`/v2` subpath) | Client contract reference for Phase 5: `useInterrupt` all-or-nothing submit, `#interrupt` slot props (verified in installed bundle); NOT used in Phase 3 code |
| `rxjs` | ^7.8.2 | Observable plumbing (unchanged from Phase 2) |

**Version verification (this session):** all four packages confirmed installed at exactly these versions; baseline suites green (50 copilotkit unit tests, 12 e2e API tests).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Canonical `RUN_FINISHED` interrupt outcome | Legacy `on_interrupt` CUSTOM event / `forwardedProps.command.resume` | **D-01 forbids it.** Documented strand: legacy-resuming clients stop resuming once they observe the structured outcome (Pitfall 5; AG-UI LangGraph README — Context7-verified this session). Reversing the canonical format later breaks clients — the format IS the published contract |
| Module-level interrupt registry | Agent instance field / runner store | The runtime clones the agent per request (`cloneAgentForRequest` — verified `handle-run.mjs`); instance state is lost. Module singleton survives clones (same pattern as the runtime's own `ɵGLOBAL_STORE`). Runner-store placement also works but couples registry to replay internals |
| In-memory registry + lazy JSONL rebuild on restart | Registry only, reject post-restart resumes | Old stack let users answer persisted decisions after restart (form re-renders from `decision_request_prompt` messages); registry-only strands them. Lazy rebuild (~30 lines, reuses `JsonlStore`) restores parity — see Open Questions |

**Installation:** none — `bun install` state unchanged. No new dependencies.

## Package Legitimacy Audit

**No packages are installed in this phase** — all dependencies pre-exist from Phases 1–2 (`@copilotkit/runtime@1.66.4`, `@copilotkit/vue@1.66.4`, `@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57`, `rxjs@^7.8.2`; pinned and asserted by `e2e/api/copilotkit/pins.test.ts`, verdicts recorded as OK/Approved in Phase 2 research). No legitimacy gate, no postinstall scrutiny, no `[ASSUMED]` package names.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Go **all-canonical** — NO legacy `on_interrupt` CUSTOM events, NO `forwardedProps.command.resume`. The bridge emits `RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }` and consumes `RunAgentInput.resume[]`. Legacy channels are deprecated and mixing them strands runs (research Pitfall 5 — the LangGraph-documented failure). — **Reversibility:** costly — the interrupt wire format is a published contract; reversing later breaks clients.
- **D-02:** Interrupt shape: `{ id, reason: "decision_request", message, metadata: { decision options/payload context } }`; id stable per decision batch. On resume: `resume[] = [{ interruptId, status: "resolved"|"cancelled", payload: { decision: "approved"|"rejected", ... } }]` — the bridge translates to `orchestrator`'s existing decision-response calls (the old decision-request workflow keeps its engine-side semantics).
- **D-03:** A run ending with interrupt outcome is a NORMAL completion (`isLoading=false`), not an error — the UI must not render it as failure (Phase 5 concern, but the event contract must carry it correctly).
- **D-04:** Pending interrupt blocks new input server-side: the bridge/runner rejects a `run()` WITHOUT `resume[]` while a decision interrupt is pending for that thread (Pitfall 5 rule; CHAT-09 success criterion 3).
- **D-05:** Resume contract rules honored: same threadId; `interruptId` must match an open interrupt; one resume array must address ALL open interrupts (partial resumes unsupported); expired interrupts (past `expiresAt`) not resumed.
- **D-06:** The Phase 2 `RailyinAgent` run loop extends its terminal mapping: engine `decision_request` → emit interrupt outcome RUN_FINISHED instead of the current "decision" placeholder terminal (Phase 2's 02-03 noted "Phase 3 replaces decision semantics"). The `onRunEnd` decision branch rewires to the interrupt outcome.
- **D-07:** Resume runs flow through the same agent run path: `RunAgentInput.resume[]` present → correlate to the pending decision execution for that thread (conversationId = threadId), deliver the translated decision to the engine (via the existing decision-submission path), continue consuming the same `AsyncIterable<EngineEvent>` — matching the old "run pauses instead of ending" UX while using canonical events.
- **D-08:** Interrupted runs persist to JSONL like any run (RUN_FINISHED with interrupt outcome is a normal terminal); replay of an interrupted run shows the decision card (Phase 5 renders); the resume run is a new run on the same thread (new runId) per the runner's per-run store model.
- **D-09:** Fake-engine contract tests prove the full cycle: engine emits `decision_request` → interrupt outcome RUN_FINISHED → resume run with `resume[]` → engine receives translated decision → stream continues. Test the block-while-pending rule and the all-interrupts-must-resolve rule.

### the agent's Discretion
- Where the pending-interrupt registry lives (bridge state vs runner store) — planner picks within the Phase 2 architecture.
- Whether `expiresAt` is set (no expiry needed for v1 decisions — planner decides).
- Exact interrupt id scheme (stable per decision batch — planner picks the format).

### Deferred Ideas (OUT OF SCOPE)
- Vue interrupt slot rendering (`#interrupt` slot, useInterrupt, decision card port) — Phase 5 (UI-03).
- Thread-index endpoint — Phase 4 (CHAT-08).
- Cancel hardening per-engine — v2 (CHAT-11).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RUNR-08 | Runner emits `RUN_FINISHED` with `outcome: interrupt` + `RunAgentInput.resume[]` entries for decision requests (canonical AG-UI contract; not the deprecated `on_interrupt` event) | Verified exact schemas in installed `@ag-ui/core@0.0.57` (`RunFinishedInterruptOutcomeSchema` :9508-9562, `RunAgentInput.resume` :2984-2987); verified runtime passes full input incl. resume to the agent (`in-memory.mjs:372`); verified runner persistence/replay preserves both (empirical test this session) |
| CHAT-09 | User can approve/reject a decision request as structured cards; the agent run genuinely pauses and resumes with the decision payload | Full resume path designed: registry validation (D-05), translation via `buildDecisionSubmission` → `executeChatTurn`/`executeHumanTurn` (existing decision path), continuation streaming on the resume run; `#interrupt` slot contract verified for Phase 5 |
| UI-03 | Decision-request UX renders as interrupt cards with structured approve/reject and payload | Phase 3 delivers the event + payload contract (`metadata` = parsed `DecisionRequestPayload`, resume payload shape documented); rendering itself is deferred to Phase 5 per CONTEXT — planner should record this split in coverage mapping |
| VERF-01 | Bridge + runner have unit tests with a fake engine (contract tests for events, interrupts, replay) | Mock engine extension design (`__SCRIPT_DECISION__` marker + continuation detection) and full test matrix (unit + e2e) specified below |
</phase_requirements>

## Architecture Patterns

### System Architecture Diagram

```
                        ┌───────────────────────────  CLIENT (Phase 5) ───────────────────────────┐
                        │  @copilotkit/vue: CopilotChat #interrupt slot ← {interrupt, interrupts,  │
                        │  resolve, cancel}  ·  useInterrupt accumulates one response per open      │
                        │  interrupt, submits ONE resume[] when ALL addressed (all-or-nothing)      │
                        └───────────────┬───────────────────────────────▲──────────────────────────┘
                                        │ run(ResumeInput)              │ SSE: events of resume run
                                        ▼                               │
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  RUNTIME (self-hosted, in Bun.serve)                                                             │
│  POST /api/copilotkit/agent/default/run  →  parseRunRequest (zod RunAgentInputSchema)           │
│       → handleSseRun → RailyinAgentRunner.run({input}) → agent.runAgent(input)  [resume[] kept] │
│                                                                                                  │
│  RailyinAgent.run(input)                                                                         │
│    ├─ validate threadId + conversation exists (THREAD_NOT_FOUND)                                 │
│    ├─ input.resume? ──► RESUME BRANCH (before extractUserText, before advisory lock)            │
│    │     ├─ registry validation: ids ⊆ open interrupts ∧ all addressed  (fail → RUN_ERROR)      │
│    │     ├─ status "cancelled" → clear registry + close executions row → RUN_FINISHED (no engine)│
│    │     └─ status "resolved" → translateResumeToSubmission(payload) → buildDecisionSubmission   │
│    │           ├─ close old waiting_user executions row (chat; else advisory lock wedges thread) │
│    │           ├─ task-linked: executeHumanTurn(taskId, userContent, …, engineContent, opts)    │
│    │           └─ chat:         executeChatTurn(0, convId, userContent, …, engineContent, opts) │
│    │                  └─ stream continuation EngineEvents → AG-UI events → resume run's subject  │
│    └─ no resume → user-text check → advisory lock (waiting_user → THREAD_BUSY = D-04 block)      │
│          → RUN_STARTED → executeChatTurn(opts) — onEngineEvent tap captures decision_request     │
│              payload; onRunEnd("decision") → finish("interrupt") emits:                          │
│              RUN_FINISHED { outcome: { type:"interrupt", interrupts:[{id, reason:"decision_request",│
│                message, metadata: DecisionRequestPayload}] } }  (NORMAL terminal, D-03)          │
│                                                                                                  │
│  RailyinAgentRunner: pipe-tap persists every event → data/threads/{threadId}.jsonl (per-run       │
│    boundaries); connect() cold path replays log (finalizeRunEvents + compactEvents — verified    │
│    to preserve interrupt outcomes and resume[] entries)                                          │
│  interrupt-registry.ts (module-level): Map<threadId, {interruptId, conversationId, executionId,  │
│    payload, createdAt}> — survives agent cloning; lazy rebuild from JSONL tail on restart         │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────  ORCHESTRATOR (unchanged semantics) ──────────────────────────────┐
│  ChatExecutor/HumanTurnExecutor → StreamProcessor.consume() → engine.execute(params)            │
│  engine emits … {type:"decision_request", payload} → waiting_user + onRunEnd("decision")        │
│  resume delivers translated decision via engine.resume() (same-execution) OR new execution      │
│  fallback when the decision generator already terminated (copilot/pi/claude abort at decision)  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 3 deltas only)

```
src/bun/copilotkit/
├── railyin-agent.ts          # REWIRE: "decision" terminal → interrupt outcome; NEW resume branch
├── event-bridge.ts           # ADD pure helpers: buildInterruptOutcome(payload), translateResumeToSubmission(resume)
├── interrupt-registry.ts     # NEW: module-level per-thread pending-interrupt registry (+ reset() for tests)
├── railyin-runner.ts         # UNCHANGED (persistence/replay already correct — verified); tests added
├── event-bridge.test.ts      # ADD: interrupt-shape + resume-translation unit tests
├── railyin-agent.test.ts     # ADD: decision-cycle, resume-validation, block-while-pending, cancel tests
├── interrupt-registry.test.ts# NEW: registry lifecycle, id stability, rebuild
└── railyin-runner.test.ts    # ADD: replay of interrupt-outcome + resume-run log shapes
src/bun/testing/mock-engine.ts# ADD: __SCRIPT_DECISION__ marker + continuation detection
e2e/api/copilotkit/railyin.test.ts  # ADD: full decision cycle over the real server (tests 11+)
```

### Pattern 1: Emit the interrupt terminal from the agent's finish(), not the bridge

**What:** The event-bridge's `translateEngineEvent` returns `[]` for `decision_request` (verified `event-bridge.ts:285`) and terminals are emitted ONLY by the agent via `terminalEvent()` (Pitfall 3 — exactly one terminal per run). The interrupt outcome therefore rides on a NEW `finish("interrupt", { interrupts })` branch; a pure `buildInterruptOutcome()` helper in event-bridge.ts produces the wire shape so unit tests can pin it.

**When to use:** Any engine `decision_request` event reaching the agent's `onEngineEvent` tap — the payload is captured there (it fires immediately BEFORE `onRunEnd("decision")`, verified stream-processor.ts:210 → :494-507), then the terminal is emitted with it.

**Key detail:** the agent must also handle `decision_request` WITHOUT a subsequent `onRunEnd` (the WR-02 async-completion guard currently covers only done/error/ask_user/shell_approval — `railyin-agent.ts:249-258`). Recommend adding a check: if a decision payload was captured and `guardedComplete()` fires, emit the interrupt terminal instead of a plain RUN_FINISHED.

### Pattern 2: Resume branch placement and validation

**What:** `run()` checks `input.resume?.length` FIRST — before `extractUserText` (a resume run's messages contain only history; the last user message is the original prompt) and before the advisory lock (a pending decision leaves an `executions` row at `'waiting_user'`, which the Phase 2 lock rejects with THREAD_BUSY — verified `railyin-agent.ts:162-168`).

**When to use:** every resume run; validation order per D-05:
1. Every `resume[i].interruptId` must be an OPEN interrupt for this thread (registry).
2. Every open interrupt for the thread must be addressed (all-or-nothing).
3. `status` must be `"resolved"` or `"cancelled"` (schema-enforced anyway).

**Example sketch (validated against installed schemas):**
```typescript
// in run(), after conversation-exists check, before extractUserText:
if (input.resume?.length) {
  const open = registry.get(threadId);            // module-level singleton
  const openIds = open ? [open.interruptId] : []; // v1: one interrupt per batch
  const addressed = new Set(input.resume.map((r) => r.interruptId));
  const allResolved =
    openIds.every((id) => addressed.has(id)) && input.resume.every((r) => openIds.includes(r.interruptId));
  if (!open || !allResolved) {
    emitRunError("Resume does not match open decision interrupt(s)", "INVALID_INTERRUPT");
    return subject.asObservable();
  }
  subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });
  const entry = input.resume.find((r) => r.interruptId === open.interruptId)!;
  if (entry.status === "cancelled") {
    registry.clear(threadId);
    closePendingExecutionRow(db, open.executionId);   // status → 'cancelled'
    finishWithoutEngine(subject, threadId, runId);    // plain RUN_FINISHED
    return subject.asObservable();
  }
  // resolved: translate and deliver through the existing decision path (see Pattern 3)
  ...
}
```

### Pattern 3: Resume → orchestrator translation (D-07)

**What:** translate the resume payload into the existing decision-submission format and deliver through `ExecutionCoordinator` — the OLD handler semantics are preserved (`tasks.submitDecisions`/`chatSessions.submitDecisions` are the reference; verified `handlers/tasks.ts:305-322`, `handlers/chat-sessions.ts:161-204`).

```typescript
// pure, in event-bridge.ts (unit-testable):
// payload (Phase 5 sends): { decision: "approved"|"rejected", answers?: DecisionAnswer[],
//                            generalNotes?: string, recordAsDecisions?: boolean }
export function translateResumeToSubmission(payload: unknown): { userContent: string; engineContent: string } | null {
  const p = payload as { answers?: DecisionAnswer[]; generalNotes?: string; recordAsDecisions?: boolean };
  if (!Array.isArray(p?.answers) || p.answers.length === 0) return null;
  return buildDecisionSubmission(p.answers, p.generalNotes, p.recordAsDecisions ?? true); // src/bun/conversation/decision-submission.ts
}

// in the agent resume branch:
// 1. close the OLD pending execution row for chat (CRITICAL — see Pitfall 3):
//    db.run("UPDATE executions SET status='completed' WHERE id = ? AND status='waiting_user'", [open.executionId]);
// 2. task-linked (SELECT task_id FROM conversations WHERE id = ?) →
//    orchestrator.executeHumanTurn(taskId, userContent, undefined, engineContent, opts)   // opts = ADDITIVE ChatTurnOpts param
//    chat → orchestrator.executeChatTurn(0, conversationId, userContent, undefined, null, workspaceKey, undefined, engineContent, opts)
// 3. registry.clear(threadId) after execute* resolves (delivery started) — prevents double-resume
```

**Verification (this session, real engine code):** for every real engine, `decision_request` TERMINATES the generator (copilot `engine.ts:348-351` yields then returns; pi `execution-controller.ts:75-79` aborts session + closes queue; claude `adapter.ts:353-362` `continue:false`; cursor `engine.ts:151-168` aborts). The old resume path therefore lands in `HumanTurnExecutor.execute()`'s catch → NEW execution fallback (`human-turn-executor.ts:81-174`), which works without a live engine session — the decision text becomes the next prompt. So "continue consuming the same AsyncIterable" (D-07) means: the resume run consumes the continuation execution's events; engine session continuity is preserved where the engine supports it (ask_user-style park) and gracefully degraded elsewhere — exactly the old behavior.

### Pattern 4: The mock-engine decision script

**What:** extend `src/bun/testing/mock-engine.ts` `SCRIPT_MARKERS` with a deterministic two-phase scenario driven by prompt markers (existing pattern, verified `mock-engine.ts:22-63`):

```typescript
if (prompt.includes("__SCRIPT_DECISION__")) {
  // Phase A (original run): text then the decision request — the run must end
  // with the interrupt outcome, NOT an error, and no events after it.
  return { events: [
    { type: "token", content: "I need your decision." },
    { type: "decision_request", payload: JSON.stringify({
        context: "mock context",
        questions: [{ question: "Choose __DECISION_OPTION__", type: "exclusive",
                      options: [{ title: "A", description: "" }, { title: "B", description: "" }] }],
      }) },
  ] };
}
if (prompt.includes("Choose __DECISION_OPTION__")) {
  // Phase B (resume run): the translated submission text contains the question
  // (buildDecisionSubmission formats "**Q [MEDIUM]:** Choose __DECISION_OPTION__").
  return { events: [
    { type: "token", content: "Decision received, continuing." },
    { type: "done" },
  ] };
}
```

This proves "engine receives the translated decision" (success criterion 2) because Phase B only fires when the formatted decision text reached `params.prompt` — which is the engineContent path (`chat-executor.ts:133-140`).

### Anti-Patterns to Avoid

- **Emitting the interrupt outcome from `translateEngineEvent`:** the bridge returning a RUN_FINISHED would collide with the agent's terminal (Pitfall 3 double-terminal). The bridge stays terminal-free; helpers only build shapes.
- **Resume branch after `extractUserText`:** resume runs carry no new user text → would reject with NO_USER_MESSAGE.
- **Resume branch after the advisory lock:** the pending decision leaves `waiting_user` → THREAD_BUSY on the resume itself.
- **Registry on the agent instance:** the runtime clones the agent per request (`cloneAgentForRequest` — verified); instance maps vanish. Module-level or runner-level only.
- **Interrupt id depending on `executionId` at emit time:** in synchronous test fakes `onRunEnd` fires before the `executeChatTurn(...).then()` resolves, so `run.executionId` is null. Use a per-thread counter or defer the terminal until `.then`.
- **Client-side accumulation re-implementation:** the Vue client already enforces all-or-nothing resume (verified `useInterrupt`); the server must still validate (D-05) — belt and suspenders, but don't build client logic server-side.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Interrupt wire format | A custom `decision_request` event / ported `on_interrupt` | Canonical `RUN_FINISHED { outcome: {type:"interrupt", …} }` (verified schema) | The published AG-UI contract; legacy channel strands runs (D-01, Pitfall 5) |
| Resume channel | `forwardedProps.command.resume` | `RunAgentInput.resume[]` | Deprecated; mixing channels strands runs |
| Decision text formatting | Re-formatting Q/A pairs in the agent | `buildDecisionSubmission()` (`src/bun/conversation/decision-submission.ts`) | Single source of truth for the hidden record_decision instructions (DH-5..DH-10 tests pin its behavior) |
| Resume-array accumulation client-side | Custom all-open-interrupts bookkeeping | `useInterrupt` (Phase 5) | Verified: records per-interrupt responses, submits one resume[] when all addressed, checks expiry |
| Replay normalization | Re-deriving per-run replay | Existing runner cold path (`finalizeRunEvents` + `compactEvents` + `completeOpenToolCalls`) | Empirically verified this session to preserve interrupt outcomes and resume[] entries |
| SSE framing | Hand-rolled encoder | Runtime's own handler (unchanged) | Pitfall 9.4 — use `@ag-ui/encoder` semantics, already in place |

**Key insight:** every piece of the "decision cycle" wire contract exists in the installed packages — schemas, client accumulation, runtime passthrough, replay normalization. The phase is a **translation layer** (EngineEvent ⇄ AG-UI interrupt), not protocol invention.

## Common Pitfalls

### Pitfall 1: Advisory lock blocks the resume run itself
**What goes wrong:** the resume run hits `executions.status='waiting_user'` → RUN_ERROR THREAD_BUSY; the decision can never be delivered.
**Why it happens:** Phase 2's lock (verified `railyin-agent.ts:162-168`) predates the resume concept.
**How to avoid:** the resume branch runs BEFORE the advisory lock; the lock becomes the D-04 block for non-resume runs. Test both directions.

### Pitfall 2: Orphaned `waiting_user` execution row wedges the thread forever (chat sessions)
**What goes wrong:** chat-session resume starts a NEW execution; the OLD decision-paused row stays `'waiting_user'`. Every subsequent run on that conversation → THREAD_BUSY. No existing code path closes it (verified: only orchestrator.cancel / human-turn-executor / stream-processor touch execution statuses, none on the chat decision path).
**Why it happens:** the old stack had no advisory lock, so the orphan was harmless; Phase 2's lock turned it into a permanent wedge.
**How to avoid:** the resume branch explicitly finalizes the pending execution row (`status='completed'` or `'cancelled'` — planner's call) before/after delivery; the cancelled path does the same. Add a contract test: decision → resume → NEW run works.

### Pitfall 3: Interrupt id minted before `executionId` is known
**What goes wrong:** unit fakes drive `onEngineEvent`/`onRunEnd` synchronously inside `executeChatTurn` — `run.executionId` is still null when the terminal is emitted; an id like `decision-<executionId>` becomes `decision-undefined`.
**Why it happens:** the `.then(({executionId}) => …)` runs on a microtask after the fake returns.
**How to avoid:** id scheme independent of executionId (`decision-${conversationId}-${seq}`, seq = per-thread counter in the registry module); or defer the decision terminal to the `.then` (matches real-engine ordering, where executionId always resolves before any engine event).

### Pitfall 4: Registry state lost on agent clones / process restart
**What goes wrong:** instance-field registry vanishes per request (clone) or on restart; a replayed decision card sends a resume for an id the registry never issued → INVALID_INTERRUPT, stranded decision.
**Why it happens:** `cloneAgentForRequest` (verified `handle-run.mjs`); in-memory state dies with the process.
**How to avoid:** module-level singleton registry (survives clones). For restart: lazy rebuild from the thread's JSONL tail (last RUN_FINISHED with interrupt outcome → id + metadata; executionId from the `waiting_user` executions row). See Open Questions for the defer option.

### Pitfall 5: `decision_request` without `onRunEnd` loses the interrupt
**What goes wrong:** the WR-02 completion guard (`railyin-agent.ts:193-201, 249-258`) covers done/error/ask_user/shell_approval but NOT decision_request; a coordinator that returns instead of calling `onRunEnd` yields a plain RUN_FINISHED — the decision silently vanishes.
**Why it happens:** the real stream-processor always calls `onRunEnd("decision")` synchronously (verified `stream-processor.ts:494-507`), so the gap only shows with non-standard coordinators/fakes.
**How to avoid:** the guard consults the captured decision payload — if present at completion, emit the interrupt terminal.

### Pitfall 6: Stranded run via legacy channels (Pitfall 5 core)
**What goes wrong:** client resumes through `forwardedProps.command.resume` after seeing the structured outcome → nothing happens server-side; run stranded.
**Why it happens:** documented AG-UI/LangGraph failure mode (Context7-verified this session); `emitInterruptOutcome` is opt-in for exactly this reason.
**How to avoid:** D-01 — never emit `on_interrupt`, never read `forwardedProps.command.resume`; assert in tests that the resume run carries `resume[]` (and that the agent ignores `forwardedProps`).

### Pitfall 7: Replay invalidates the interrupt terminal
**What goes wrong:** `connect()` replay chokes on (a) a second RUN_STARTED after the interrupt-terminal run, or (b) the outcome being stripped by compaction.
**Why it happens:** replay normalization is the classic breaking point (Pitfall 2 in PITFALLS.md).
**How to avoid:** empirically verified this session — `compactEvents` preserves `outcome.interrupt` and `RUN_STARTED.input.resume[]`, `finalizeRunEvents` early-returns when terminals exist (multi-run replay valid). Add a unit test pinning the exact log shape.

### Pitfall 8: Double-resume / duplicate delivery
**What goes wrong:** the client (or a retry) submits the same resume twice; the decision is delivered to the engine twice (duplicate record_decision instructions).
**Why it happens:** no idempotency guard on the resume.
**How to avoid:** clear the registry entry when the translated execution starts (after `execute*` resolves); a second resume for a cleared interrupt → INVALID_INTERRUPT. Test it.

## Code Examples

Verified patterns from installed packages and official docs:

### Interrupt outcome — verified schema (`node_modules/@ag-ui/core/dist/index.d.ts:9508-9562`, verbatim)
```typescript
// RunFinishedInterruptOutcomeSchema — outcome field of RUN_FINISHED:
{
  type: "interrupt",
  interrupts: [{
    id: string;                       // REQUIRED
    reason: string;                   // REQUIRED — "decision_request" for Railyin
    message?: string;                 // human-readable summary
    toolCallId?: string;              // n/a for Railyin
    responseSchema?: Record<string, any>;  // n/a for v1
    expiresAt?: string;               // omitted for v1 (discretion: no expiry)
    metadata?: Record<string, any>;   // parsed DecisionRequestPayload — the Phase 5 card data
  }],
}
```

### Interrupt event — verified schema (`@ag-ui/core/dist/index.d.ts:2267-2289`) — same field set as above minus `type`/`interrupts`.

### `RunAgentInput.resume[]` — verified schema (`@ag-ui/core/dist/index.d.ts:2984-2987`, verbatim)
```typescript
resume?: { interruptId: string; status: "resolved" | "cancelled"; payload?: any }[]
```

### Detecting and resuming — official AG-UI docs (Context7, `docs/concepts/interrupts.mdx` + LangGraph TS README)
```typescript
// detect:
if (event.type === EventType.RUN_FINISHED && event.outcome?.type === "interrupt") {
  for (const interrupt of event.outcome.interrupts) {
    console.log(interrupt.id, interrupt.reason, interrupt.message);
  }
}
// resume (recommended channel):
const input = { threadId: "t1", runId: "r2", messages: [], resume: [
  { interruptId: "int-abc", status: "resolved", payload: { approved: true } },
]};
```

### `buildInterruptOutcome` helper sketch (event-bridge.ts)
```typescript
// Source: this research — pure, mirrors the verified schema above
export function buildInterruptOutcome(
  threadId: string,
  runId: string,
  payload: string,               // serialised DecisionRequestPayload (EngineEvent field)
  interruptId: string,
): BaseEvent {
  let parsed: DecisionRequestPayload | null = null;
  try { parsed = JSON.parse(payload); } catch { /* keep null — metadata optional */ }
  return {
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    outcome: {
      type: "interrupt",
      interrupts: [{
        id: interruptId,
        reason: "decision_request",
        message: parsed?.context ?? "A decision is required.",
        metadata: parsed ?? undefined,
      }],
    },
  };
}
```

### Client resume submission — verified `useInterrupt` implementation (`@copilotkit/vue@1.66.4` bundle, `use-render-activity-message-CaArNmtw.js:9160-9230`)
```javascript
// resolve(payload, interruptId?) → records { status: "resolved", payload }
// cancel(interruptId?)        → records { status: "cancelled" } (no payload)
// submits ONE runAgent({ agent, resume }) ONLY when every open interrupt is addressed:
//   await n.value.runAgent({ agent: w, resume: v });
// skips expired interrupts; legacy interrupts resume via forwardedProps.command.resume (deprecated)
// #interrupt slot props: { event, interrupt, interrupts, result, resolve, cancel }  (verified :5810-5814)
```

### Resume-payload translation target — existing in-repo (verified `src/bun/conversation/decision-submission.ts:17-41`)
```typescript
export function buildDecisionSubmission(answers: DecisionAnswer[], generalNotes?: string, recordAsDecisions = true): DecisionSubmission
// → { userContent, engineContent }  — engineContent carries the hidden record_decision instruction
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tasks.submitDecisions` / `chatSessions.submitDecisions` RPC → `executeHumanTurn`/`executeChatTurn` | Same orchestrator call, but reached via `RunAgentInput.resume[]` → agent resume branch | This phase | UI decouples from RPC handlers; decision path semantics preserved engine-side |
| `onRunEnd("decision")` → plain RUN_FINISHED (`terminalEvent("decision")`, `event-bridge.ts:315-325`) | `onRunEnd("decision")` → RUN_FINISHED with interrupt outcome | This phase (D-06) | The wire now carries structured options; Phase 5 renders the card |
| `useHumanInTheLoop` considered for decision UX (STACK.md:60) | `useInterrupt` (standard interrupts) | Phase 2 research | Verified: `useInterrupt` handles both channels, all-or-nothing resume |

**Deprecated/outdated:**
- `forwardedProps.command.resume`: deprecated resume channel (Pitfall 5; D-01) — the installed Vue client still implements it for legacy interrupts, but Railyin must never emit legacy interrupts.
- Legacy `on_interrupt` CUSTOM event: deprecated; AG-UI integrations default `emitInterruptOutcome` off only because legacy clients strand — Railyin is a greenfield canonical client.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Resume payload shape sent by Phase 5 is `{ decision: "approved"\|"rejected", answers?: DecisionAnswer[], generalNotes?, recordAsDecisions? }` (D-02 locks `decision`, the rest is inferred from the old `submitDecisions` params) | Pattern 3 | Low — `translateResumeToSubmission` is a pure function with one call site; adjusting the payload field names is a small diff. The phase should document the contract in a comment near the translator so Phase 5 matches it |
| A2 | Post-restart pending-interrupt handling: lazy registry rebuild from JSONL (recommended) OR documented rejection (defer) — planner's call | Open Question 1 | Medium — skipping the rebuild strands decisions after restart, below old-stack parity |
| A3 | Interrupt id scheme `decision-${conversationId}-${seq}` (per-thread counter) | Pattern 2 | Low — id is opaque to the client; any stable-per-batch scheme satisfies D-02/D-05 |
| A4 | `status: "cancelled"` delivers NOTHING to the engine — it clears the registry, closes the execution row, and completes the run (verified: no cancel/dismiss path exists anywhere in the old handlers) | Pattern 2 | Medium — if Phase 5 expects the engine to "continue after rejection", a follow-up turn is needed; v1 treat as dismissal |
| A5 | `expiresAt` omitted for v1 (discretion) | Code Examples | Low — client-side `isInterruptExpired` then never expires; no expiry needed for decisions per CONTEXT |
| A6 | `executeHumanTurn` gains an optional `opts?: ChatTurnOpts` param (additive: coordinator.ts, orchestrator.ts, human-turn-executor.ts, passing opts into `runNonNative`) so task-linked resume runs can stream AG-UI events | Pattern 3 | Medium — if rejected as too invasive, the resume branch can always use `executeChatTurn` (works for task-linked conversations too, but loses same-execution engine resume for tasks) |

## Open Questions

1. **Post-restart pending interrupts: rebuild or reject?**
   - What we know: the DB `waiting_user` row persists (block stays enforced, D-04 durable); the registry is in-memory; the client replays the decision card from JSONL and will send a resume with the persisted interruptId.
   - What's unclear: whether to rebuild the registry lazily (scan thread JSONL for the last interrupt-outcome terminal + correlate the DB execution row; ~30 lines reusing `JsonlStore`) or reject post-restart resumes with a clear INVALID_INTERRUPT (stranded decision — old stack had parity here).
   - Recommendation: rebuild; defer only if the phase is time-boxed, with the limitation documented and a follow-up ticket.

2. **Exact resume payload field names (Phase 5 handoff)**
   - What we know: D-02 locks `payload.decision: "approved"|"rejected"`; the old RPC params were `{ answers, generalNotes, recordAsDecisions }`.
   - What's unclear: whether Phase 5 sends `payload.answers` verbatim or nests under `payload.data`.
   - Recommendation: define and document the contract in `translateResumeToSubmission`'s doc comment now (single source of truth); Phase 5 adapts.

3. **`executeHumanTurn` opts plumbing scope**
   - What we know: task-linked threads need AG-UI event streaming on the resume run; `executeChatTurn` already takes `opts`, `executeHumanTurn` doesn't (verified coordinator.ts:14).
   - What's unclear: whether the small additive change (3 files, pass-through) is in scope or the resume branch should route task threads through `executeChatTurn` too.
   - Recommendation: add the opts param (preserves same-execution engine resume for tasks — the old flow's primary path).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | All tests + server | ✓ | 1.4.0 | — |
| Node.js | dev tooling (ctx7, npm) | ✓ | 20.20.1 | — |
| `@ag-ui/core` / `@ag-ui/client` | Wire schemas + types | ✓ (installed) | 0.0.57 | pinned exact |
| `@copilotkit/runtime` | Runner + runtime | ✓ (installed) | 1.66.4 | pinned exact |
| `@copilotkit/vue` | Client contract (Phase 5 ref) | ✓ (installed) | 1.66.4 | pinned exact |
| SQLite (bun:sqlite) | Board/execution state | ✓ (built-in) | — | — |
| Mock execution engine | Contract tests | ✓ (in-repo) | — | scripted markers to extend |
| External services (LLM APIs, MCP servers) | Real-engine decision paths | N/A — phase uses fake engine only | — | contract tests never call real engines |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (vitest runner via `bun test`) |
| Config file | `vitest.config.ts` (aliases `@` → `src/mainview/`, `@shared` → `src/shared/`, `@bun` → `src/bun/`) |
| Quick run command | `bun test src/bun/copilotkit --timeout 20000` |
| Full suite command | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RUNR-08 | `decision_request` → RUN_FINISHED interrupt outcome, exact shape, normal terminal | unit | `bun test src/bun/copilotkit/railyin-agent.test.ts` (new) | ❌ Wave 0 — phase deliverable |
| RUNR-08 | `buildInterruptOutcome` pure shape | unit | `bun test src/bun/copilotkit/event-bridge.test.ts` (new tests) | ❌ phase deliverable |
| RUNR-08 | resume[] flows runner→agent; replay preserves outcome + resume | unit + e2e | `railyin-runner.test.ts` (new) + `e2e/api/copilotkit/railyin.test.ts` (new tests) | ❌ phase deliverable |
| CHAT-09 | resume translates payload → `executeChatTurn`/`executeHumanTurn` → continuation streams | unit | `railyin-agent.test.ts` | ❌ phase deliverable |
| CHAT-09 | block-while-pending (D-04): non-resume run rejected | unit + e2e | `railyin-agent.test.ts` + e2e | ❌ phase deliverable |
| CHAT-09 | D-05: unknown interruptId / partial resume / duplicate resume rejected | unit | `interrupt-registry.test.ts` + `railyin-agent.test.ts` | ❌ phase deliverable |
| UI-03 | event contract carries metadata (DecisionRequestPayload) for the Phase 5 card | unit | `event-bridge.test.ts` | ❌ phase deliverable |
| VERF-01 | full fake-engine cycle incl. replay (D-09) | unit + e2e | both suites above | ❌ phase deliverable |

### Sampling Rate
- **Per task commit:** `bun test src/bun/copilotkit --timeout 20000`
- **Per wave merge:** full suite command above
- **Phase gate:** full suite green before `/gsd-verify-work` (Phase 2 closed at 2315 backend / 65 e2e / 0 typecheck errors)

### Wave 0 Gaps
- None required — the test infra (fixtures, mock engine, startServer, helpers) exists from Phases 1–2; the new test files ARE the phase's deliverables (VERF-01). Baseline verified green this session: 50 copilotkit unit tests, 12 e2e API tests.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | local single-user loopback app; no auth surface (existing posture) |
| V3 Session Management | no | none (no sessions) |
| V4 Access Control | no | none (no multi-user) |
| V5 Input Validation | yes | `RunAgentInputSchema` (zod) validates the wire incl. resume entries (verified `agent-utils.mjs:113-131`); agent-side registry validation of `interruptId`/`status` (D-05); resume payload treated as untrusted |
| V6 Cryptography | no | no new keys/secrets; never forward engine keys (existing `forwardHeaders` denylist posture) |

### Known Threat Patterns for {stack}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Resume for an interrupt the server never issued (id mismatch / replay of an old id) | Spoofing | Registry validation: interruptId must be OPEN for that thread and all open interrupts addressed (D-05); duplicate resume after clearing → INVALID_INTERRUPT |
| Decision payload injection into engine context | Tampering | Payload flows into `engineContent`/prompt exactly like chat text (existing trust boundary — the engine treats user input as untrusted; prompt-ref discipline applies). No new privilege granted by resume |
| threadId traversal via resume run | Tampering | Existing defenses unchanged and re-verified: agent regex `/^\d+$/` (`railyin-agent.ts:136`) + `JsonlStore.assertThreadId` containment check (`jsonl-store.ts:38-47`) |
| Cross-origin abuse of the AG-UI mount | Spoofing/DoS | Existing origin guard (e2e tests g/h pin 403 behavior) — resume runs use the same mount, no new surface |

## Sources

### Primary (HIGH confidence)
- **Installed package verification (this session):** `node_modules/@ag-ui/core/dist/index.d.ts` (RunAgentInput.resume :2984-2987; InterruptSchema :2267-2289; RunFinishedInterruptOutcomeSchema :9508-9562; RunFinishedEventSchema :9620-9694); `node_modules/@ag-ui/client/dist/index.d.ts` (AbstractAgent.pendingInterrupts :487-494; buildResumeArray/isInterruptExpired :620-627); `node_modules/@copilotkit/runtime/dist/v2/runtime/handlers/handle-run.mjs` (cloneAgentForRequest + parseRunRequest + setMessages + handleSseRun); `.../handlers/shared/agent-utils.mjs:113-131` (RunAgentInputSchema.parse); `.../runtime/runner/in-memory.mjs:297-432` (runAgent(request.input) passthrough, finalizeRunEvents, connect replay); `node_modules/@copilotkit/vue/dist/use-render-activity-message-CaArNmtw.js:9116-9230, 5805-5820` (useInterrupt all-or-nothing + #interrupt slot props); `node_modules/@copilotkit/core/dist/index.mjs:5590-5656` (resolve/cancel/expired/resume assembly)
- **Empirical (this session):** compactEvents + finalizeRunEvents preserve interrupt outcomes and `RUN_STARTED.input.resume[]` across a two-run replay (executed against installed packages)
- **In-repo source reads (this session):** `src/bun/copilotkit/railyin-agent.ts` (full), `event-bridge.ts` (full), `railyin-runner.ts` (full), `jsonl-store.ts` (full), `src/bun/engine/types.ts:20-62,188-238`, `src/bun/engine/stream/stream-processor.ts:145-215,423-508`, `src/bun/engine/execution/chat-executor.ts` (full), `human-turn-executor.ts:47-174`, `src/bun/engine/copilot/engine.ts:99-108,327-363`, `src/bun/engine/pi/execution-controller.ts:52-137`, `src/bun/engine/claude/adapter.ts:300-379`, `src/bun/engine/coordinator.ts` (full), `src/bun/conversation/decision-submission.ts` (full), `src/bun/handlers/tasks.ts:305-322`, `src/bun/handlers/chat-sessions.ts:161-204`, `src/bun/testing/mock-engine.ts` (full), `src/shared/rpc-types.ts:258-327` (DecisionRequestPayload/DecisionAnswer verbatim), `src/bun/index.ts:160-200`
- **Project research:** `.planning/research/PITFALLS.md` §Pitfall 5 (lines 104-131), `.planning/research/STACK.md` (lines 76, 94-96, 109-117), `.planning/phases/02-ag-ui-bridge-railyinagentrunner/02-RESEARCH.md` (lines 346-353, 413-453), `02-03-SUMMARY.md` (agent/runner surfaces)

### Secondary (MEDIUM confidence)
- Context7 `/ag-ui-protocol/ag-ui` — `docs/concepts/interrupts.mdx` + LangGraph TS/Python READMEs: interrupt detection, resume contract rules (same threadId, id match, all-open-addressed, pending-blocks-input), stranded-run warning, emitInterruptOutcome opt-in — fetched this session
- Context7 `/copilotkit/copilotkit` — `packages/runtime/skills/runtime/references/agent-runners.md`: custom runner contract (`agent.run(request.input)`, "Thread already running") — fetched this session

### Tertiary (LOW confidence)
- none — all claims verified against installed packages, official docs, or in-repo source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; installed versions verified; baseline suites green this session
- Architecture: HIGH — every integration point (agent finish(), run() ordering, executor resume semantics, runner replay) read from source or exercised empirically
- Pitfalls: HIGH — Pitfall 2 (orphaned waiting_user row) is a verified code-level defect with no existing fix; Pitfall 3 (id timing) verified against the test fakes' synchronous contract

**Research date:** 2026-08-09
**Valid until:** 2026-09-08 (pinned 1.66.4/0.0.57 — stable until any pin bump; re-verify against installed packages, not docs, on bump per STATE.md blocker note)
