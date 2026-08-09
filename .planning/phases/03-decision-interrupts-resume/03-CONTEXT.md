# Phase 3: Decision Interrupts & Resume - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes decision_request the only human-in-the-loop channel via **canonical AG-UI interrupts**: the bridge translates an engine `decision_request` into a `RUN_FINISHED` event with `outcome: { type: "interrupt", interrupts: [...] }` (run ends cleanly, NOT an error), the client renders a structured decision card (CopilotKit Vue `#interrupt` slot / `useInterrupt`), and the user's approve/reject starts a resume run whose `RunAgentInput.resume[]` carries the decision payload — which the bridge translates back into the existing decision-request workflow. Proven by fake-engine contract tests covering events, interrupt outcome, resume, and replay. Deliberately NOT in scope: any Vue UI component work (Phase 5 renders the interrupt slot), thread-index endpoint (Phase 4), cancel hardening (v2).

</domain>

<decisions>
## Implementation Decisions

### Canonical Interrupt Contract (the core)
- **D-01:** Go **all-canonical** — NO legacy `on_interrupt` CUSTOM events, NO `forwardedProps.command.resume`. The bridge emits `RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }` and consumes `RunAgentInput.resume[]`. Legacy channels are deprecated and mixing them strands runs (research Pitfall 5 — the LangGraph-documented failure). — **Reversibility:** costly — the interrupt wire format is a published contract; reversing later breaks clients.
- **D-02:** Interrupt shape: `{ id, reason: "decision_request", message, metadata: { decision options/payload context } }`; id stable per decision batch. On resume: `resume[] = [{ interruptId, status: "resolved"|"cancelled", payload: { decision: "approved"|"rejected", ... } }]` — the bridge translates to `orchestrator`'s existing decision-response calls (the old decision-request workflow keeps its engine-side semantics).
- **D-03:** A run ending with interrupt outcome is a NORMAL completion (`isLoading=false`), not an error — the UI must not render it as failure (Phase 5 concern, but the event contract must carry it correctly).

### Server-Side Enforcement
- **D-04:** Pending interrupt blocks new input server-side: the bridge/runner rejects a `run()` WITHOUT `resume[]` while a decision interrupt is pending for that thread (Pitfall 5 rule; CHAT-09 success criterion 3).
- **D-05:** Resume contract rules honored: same threadId; `interruptId` must match an open interrupt; one resume array must address ALL open interrupts (partial resumes unsupported); expired interrupts (past `expiresAt`) not resumed.

### Bridge Integration (Phase 2 extension)
- **D-06:** The Phase 2 `RailyinAgent` run loop extends its terminal mapping: engine `decision_request` → emit interrupt outcome RUN_FINISHED instead of the current "decision" placeholder terminal (Phase 2's 02-03 noted "Phase 3 replaces decision semantics"). The `onRunEnd` decision branch rewires to the interrupt outcome.
- **D-07:** Resume runs flow through the same agent run path: `RunAgentInput.resume[]` present → correlate to the pending decision execution for that thread (conversationId = threadId), deliver the translated decision to the engine (via the existing decision-submission path), continue consuming the same `AsyncIterable<EngineEvent>` — matching the old "run pauses instead of ending" UX while using canonical events.

### Persistence & Replay of Interrupts
- **D-08:** Interrupted runs persist to JSONL like any run (RUN_FINISHED with interrupt outcome is a normal terminal); replay of an interrupted run shows the decision card (Phase 5 renders); the resume run is a new run on the same thread (new runId) per the runner's per-run store model.

### Testing (VERF-01)
- **D-09:** Fake-engine contract tests prove the full cycle: engine emits `decision_request` → interrupt outcome RUN_FINISHED → resume run with `resume[]` → engine receives translated decision → stream continues. Test the block-while-pending rule and the all-interrupts-must-resolve rule.

### the agent's Discretion
- Where the pending-interrupt registry lives (bridge state vs runner store) — planner picks within the Phase 2 architecture.
- Whether `expiresAt` is set (no expiry needed for v1 decisions — planner decides).
- Exact interrupt id scheme (stable per decision batch — planner picks the format).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (produced this project)
- `.planning/research/PITFALLS.md` §Pitfall 5 (lines 102-131) — THE interrupt contract reference: canonical vs legacy channels, resume rules (same threadId, all-interrupts-must-resolve, block-while-pending, expiry), all-canonical guidance, warning signs, and the stranded-run failure mode.
- `.planning/research/STACK.md` lines 76, 95-96, 112 — canonical interrupt outcome + resume entries; `useInterrupt` client contract; legacy deprecation.
- `.planning/research/ARCHITECTURE.md` lines 99-116, 224-244 — decision_request mapping, interrupt slot, forwardedProps resume (legacy — for contrast only; D-01 forbids it).
- `.planning/research/FEATURES.md` — decision cards as interrupt UI, HITL scope.
- `.planning/research/SUMMARY.md` — Phase 3 = "Decision Interrupts & Resume" (standard patterns, well-documented contract).

### Project documents
- `.planning/PROJECT.md` — decision_request as only HITL, thread = conversation, decision records.
- `.planning/REQUIREMENTS.md` — RUNR-08, CHAT-09, UI-03, VERF-01 (this phase).
- `.planning/ROADMAP.md` §Phase 3 — 4 success criteria.

### Codebase (integration points)
- `src/bun/copilotkit/railyin-agent.ts` — Phase 2 agent; the "decision" terminal branch to rewire (D-06).
- `src/bun/copilotkit/event-bridge.ts` — Phase 2 translation; decision_request mapping + interrupt outcome emission.
- `src/bun/copilotkit/railyin-runner.ts` — Phase 2 runner; pending-interrupt blocking hook (D-04), resume run handling.
- `src/bun/engine/orchestrator.ts` — existing decision-response calls (`respondDecisionRequest`-family) the resume path translates to.
- `src/bun/conversation/decision-submission.ts` — existing decision submission workflow.
- `src/bun/testing/mock-engine.ts` — scripted engine extension for decision_request scenarios.
- `.planning/phases/02-ag-ui-bridge-railyinagentrunner/02-SUMMARY.md` — what Phase 2 built (agent/runner/bridge surfaces).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/bun/copilotkit/railyin-agent.ts` — run loop with `onRunEnd` terminal mapping incl. the "decision" branch (Phase 3 rewires it — D-06).
- `src/bun/copilotkit/railyin-runner.ts` — runner with run-lock, JSONL persistence, replay; resume runs are new runs on same thread (fits the store model).
- `src/bun/engine/orchestrator.ts` — decision-response call surface already used by the legacy decision UX.
- `src/bun/testing/mock-engine.ts` — scripted scenarios (`__SCRIPT_*` markers) — extend with a decision-request script.
- `e2e/api/copilotkit/railyin.test.ts` — Phase 2 e2e scaffolding for the new interrupt e2e tests.

### Established Patterns
- Pure translation module (event-bridge.ts) with co-located unit tests.
- Config-driven behavior; engine adapter layer unchanged.
- TDD discipline (RED→GREEN per task) established in Phase 2.
- E2E: real server via startServer fixture; probe tests stay green.

### Integration Points
- `RailyinAgent.run()` — where the decision terminal mapping changes.
- `event-bridge.ts` — decision_request → interrupt outcome emission.
- `railyin-runner.ts` — pending-interrupt block + resume routing.
- `orchestrator` decision-response methods — the translation target for resume payloads.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 1: "engine run genuinely pauses (no further tokens or tool calls)" — the interrupt outcome ends the run; the paused engine execution is resumed server-side on the resume run.
- Success criterion 2: "user can approve or reject with a payload; the run resumes and the engine receives the decision response via RunAgentInput.resume[]" — the resume translation is the phase's core proof.
- Success criterion 4: "contract tests with a fake engine prove the full decision cycle — events, interrupt outcome, resume, and replay — end to end" — D-09.

</specifics>

<deferred>
## Deferred Ideas

- Vue interrupt slot rendering (`#interrupt` slot, useInterrupt, decision card port) — Phase 5 (UI-03).
- Thread-index endpoint — Phase 4 (CHAT-08).
- Cancel hardening per-engine — v2 (CHAT-11).

</deferred>

---

*Phase: 3-Decision Interrupts & Resume*
*Context gathered: 2026-08-09*
