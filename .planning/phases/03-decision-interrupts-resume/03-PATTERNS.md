# Phase 3: Decision Interrupts & Resume - Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 13 (8 modify, 2 new, 2 modify-or-not per A6 discretion, 1 unchanged translation target)
**Analogs found:** 13 / 13 (12 self-analogs from Phase 2 + 1 role-match for the new registry)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/bun/copilotkit/railyin-agent.ts` (MODIFY) | agent / run-loop controller | streaming request-response | itself (Phase 2) — `finish()` terminal, `onRunEnd` branch, advisory lock | exact (self) |
| `src/bun/copilotkit/event-bridge.ts` (MODIFY) | utility (pure translation module) | transform | itself — `terminalEvent()` builder, `decision_request` → `[]` case | exact (self) |
| `src/bun/copilotkit/interrupt-registry.ts` (NEW) | store (module-level singleton registry) | event-driven (set/clear/query) | `src/bun/copilotkit/jsonl-store.ts` (per-thread keyed state) + `TranslateState` in event-bridge.ts:20-58 | role-match |
| `src/bun/copilotkit/railyin-runner.ts` (code UNCHANGED; tests MODIFY) | runner | streaming / file-I/O | itself — `connect()` cold-replay path | exact (self) |
| `src/bun/copilotkit/event-bridge.test.ts` (MODIFY) | test | — | itself — `assertValid()` EventSchemas contract | exact (self) |
| `src/bun/copilotkit/railyin-agent.test.ts` (MODIFY) | test | — | itself — fake-coordinator + collectRun pattern | exact (self) |
| `src/bun/copilotkit/interrupt-registry.test.ts` (NEW) | test | — | `railyin-runner.test.ts` (fresh-state beforeEach + per-thread keys) | role-match |
| `src/bun/copilotkit/railyin-runner.test.ts` (MODIFY) | test | — | itself — `ev()`/`appendCompletedRun()` log-shape builders | exact (self) |
| `src/bun/testing/mock-engine.ts` (MODIFY) | utility (fake engine) | transform (scripted events) | itself — `SCRIPT_MARKERS` + `scriptedEvents()` | exact (self) |
| `e2e/api/copilotkit/railyin.test.ts` (MODIFY) | test (e2e) | — | itself — `postJson`/`parseSseFrames` + startServer fixture | exact (self) |
| `src/bun/engine/coordinator.ts` (MODIFY only if A6 accepted) | interface / config | — | itself — `ChatTurnOpts` interface (lines 7-10) | exact (self) |
| `src/bun/engine/orchestrator.ts` (MODIFY only if A6 accepted) | controller facade | request-response | itself — `executeChatTurn` opts pass-through (lines 163-175) | exact (self) |
| `src/bun/engine/execution/human-turn-executor.ts` (MODIFY only if A6 accepted) | service / executor | streaming | itself — resume path (lines 66-175); `chat-executor.ts:188` opts precedent | exact (self) |
| `src/bun/conversation/decision-submission.ts` (UNCHANGED — translation TARGET) | utility | transform | itself — `buildDecisionSubmission` (lines 17-41) | exact (self) |

**Reference-only (no edits):** `src/bun/engine/stream/stream-processor.ts:494-506` (decision_request → `waiting_user` + `onRunEnd("decision")` — the orphaned-row finalize target), `src/bun/handlers/chat-sessions.ts:161-204` (`chatSessions.submitDecisions` — the legacy decision path the resume replaces), `src/bun/handlers/tasks.ts:305-322` (task-side twin).

---

## Pattern Assignments

### `src/bun/copilotkit/railyin-agent.ts` (agent/run-loop, streaming request-response)

**Analog:** itself (Phase 2). This is a REWIRE of existing branches, not new machinery.

**Imports pattern** (lines 17-30) — keep, add registry import:
```typescript
import { AbstractAgent, type BaseEvent } from "@ag-ui/client";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { ReplaySubject } from "rxjs";
import type { Database } from "bun:sqlite";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import type { EngineEvent } from "../engine/types.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";
import { createTranslateState, translateEngineEvent, synthesizeMissingToolResults, terminalEvent, type TranslateState } from "./event-bridge.ts";
```

**Error-emission pattern** (lines 129-134) — reuse for resume-validation failures (D-05). RUN_STARTED first, RUN_ERROR with code, complete, clear activeRun:
```typescript
const emitRunError = (message: string, code?: string): void => {
  subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });
  subject.next({ type: EventType.RUN_ERROR, message, code });
  subject.complete();
  if (this.activeRun === run) this.activeRun = null; // IN-02: no stale pointer
};
```
New error code: `INVALID_INTERRUPT` (research Pattern 2 sketch line 185).

**Insertion point for the resume branch** (D-07, research Pitfall 1/Pattern 2): AFTER the conversation-exists check (line 147) and BEFORE `extractUserText` (line 149) and BEFORE the advisory lock (line 162). Current ordering to rewire:
```typescript
// line 140-147: conversationId = Number(threadId); conversation exists check → THREAD_NOT_FOUND
// line 149-153: const content = extractUserText(input.messages);  ← resume runs FAIL here (no new user text)
// line 162-168: advisory lock on executions.status IN ('running','waiting_user')  ← resume runs FAIL here (THREAD_BUSY on the pending decision row)
// line 185: subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });  // RUN_STARTED FIRST
```
The advisory lock (lines 162-168) becomes the D-04 block for NON-resume runs — unchanged code, new test coverage:
```typescript
const active = this.db
  .query("SELECT 1 FROM executions WHERE conversation_id = ? AND status IN ('running','waiting_user')")
  .get(conversationId);
if (active) {
  emitRunError("Thread already has an active execution", "THREAD_BUSY");
  return subject.asObservable() as unknown as ReturnType<AbstractAgent["run"]>;
}
```

**Terminal emission pattern — `finish()`** (lines 203-226) — the interrupt terminal is a NEW branch on this shape. Copy the closer/synthesizer prologue verbatim; only the terminal call differs:
```typescript
const finish = (
  outcome: "done" | "error" | "aborted" | "decision",
  error?: { message: string; code?: string },
): void => {
  if (terminalEmitted) return;
  terminalEmitted = true;
  const closers = translateEngineEvent({ type: "done" }, state);
  for (const ev of closers) subject.next(ev);
  const synthesized = synthesizeMissingToolResults(state, accumulated);
  for (const ev of synthesized.slice(accumulated.length)) subject.next(ev);
  subject.next(terminalEvent(threadId, runId, outcome, error));  // ← Phase 3: interrupt variant carries outcome.interrupts
  subject.complete();
  if (this.activeRun === run) this.activeRun = null; // IN-02: no stale pointer
};
```
Phase 3 adds an `"interrupt"` terminal (D-06): a new `finishInterrupt(interrupt)` (or extended `finish`) that builds the RUN_FINISHED with `outcome: { type: "interrupt", interrupts: [...] }` via the new event-bridge helper, keeping the same closer/synthesize/complete/clear sequence. `terminalEvent` (event-bridge.ts:315-325) gains the interrupt outcome path — see its assignment below.

**WR-02 completion guard** (lines 193-201, 249-258) — MUST gain a decision_request check (research Pitfall 5): if a decision payload was captured and `guardedComplete()` fires, emit the interrupt terminal instead of plain RUN_FINISHED. Current guard list (line 250-254):
```typescript
if (
  event.type === "done" ||
  event.type === "error" ||
  event.type === "ask_user" ||
  event.type === "shell_approval"
) {
  queueMicrotask(() => { if (!terminalEmitted) guardedComplete(); });
}
```

**onEngineEvent tap** (lines 232-259) — `decision_request` currently translates to `[]` (event-bridge.ts:285) and is NOT in the guard list. Phase 3 captures its payload here (research Pattern 1 — the payload fires immediately BEFORE `onRunEnd("decision")`, stream-processor.ts:494-507).

**onRunEnd branch** (lines 260-266) — the "decision" outcome currently lands in `finish(outcome)`:
```typescript
onRunEnd: (outcome) => {
  if (outcome === "error") {
    finish("error", { message: lastEngineError ?? "Run failed", code: "ENGINE_ERROR" });
  } else {
    finish(outcome);
  }
},
```
Phase 3 (D-06): `outcome === "decision"` → emit the interrupt terminal with the captured payload + registry registration (id minted per-thread counter — Pitfall 3: NEVER `decision-${executionId}` because `run.executionId` is null during the synchronous fake dispatch; use `decision-${conversationId}-${seq}` or defer to the `.then`).

**executeChatTurn call + then/catch** (lines 230-289) — the resume branch mirrors this call with the TRANSLATED submission (research Pattern 3):
- chat: `executeChatTurn(0, conversationId, userContent, undefined, null, workspaceKey, undefined, engineContent, opts)` — same signature as line 231.
- task-linked (only if A6 accepted): `executeHumanTurn(taskId, userContent, undefined, engineContent, opts)` via the new opts param.
- `.then(({ executionId }) => ...)` at lines 268-283 shows the executionId-arrival pattern; the resume branch additionally closes the OLD pending `waiting_user` execution row (Pitfall 2 — orphaned row wedges the thread forever):
```typescript
db.run("UPDATE executions SET status='completed' WHERE id = ? AND status='waiting_user'", [open.executionId]);
```
- registry.clear(threadId) after execute* resolves (Pitfall 8 — double-resume guard).

**Cancelled-resume path** (A4): registry.clear + close the execution row (`status='cancelled'`) + plain RUN_FINISHED WITHOUT engine call — no existing cancel/dismiss path exists in the old handlers; this is new code following the emitRunError/finish shapes.

**`clone()` re-attach pattern** (lines 90-95) — unchanged; the registry must NOT live on the agent (Pitfall 4 — `cloneAgentForRequest` copies only fixed fields; instance state vanishes).

---

### `src/bun/copilotkit/event-bridge.ts` (pure translation module, transform)

**Analog:** itself. Module doc pattern (lines 1-15) — stays terminal-free (Pitfall 3: bridge never emits terminals; anti-pattern 1).

**`decision_request` case today** (line 285-286) — returns `[]`; the payload capture happens in the agent, NOT here:
```typescript
case "ask_user":
case "shell_approval":
case "decision_request":
  return [];
```

**Shape-builder pattern — `terminalEvent`** (lines 315-325): the template for the new `buildInterruptOutcome` (Phase 3 extends the outcome union with `"interrupt"`; the interrupt RUN_FINISHED carries `outcome.interrupts` instead of `result: null`):
```typescript
export function terminalEvent(
  threadId: string,
  runId: string,
  outcome: "done" | "error" | "aborted" | "decision",
  error?: { message: string; code?: string },
): BaseEvent {
  if (outcome === "error") {
    return { type: EventType.RUN_ERROR, message: error?.message ?? "Run failed", code: error?.code };
  }
  return { type: EventType.RUN_FINISHED, threadId, runId, result: null };
}
```

**Small pure shape builder precedent — `toolResult`** (lines 61-69): the module's convention for a wire-shape helper with doc comment; `buildInterruptOutcome(threadId, runId, payload, interruptId)` follows the RESEARCH.md sketch (research lines 361-387): parse `payload` JSON defensively (`try { parsed = JSON.parse(payload) } catch { keep null }`), emit `{ type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: "interrupt", interrupts: [{ id, reason: "decision_request", message: parsed?.context ?? "A decision is required.", metadata: parsed ?? undefined }] } }`.

**`translateResumeToSubmission`** — new pure helper (research Pattern 3, lines 209-213): validates `payload.answers` is a non-empty array, then delegates to `buildDecisionSubmission` (the "Don't Hand-Roll" row 3 — never re-format Q/A pairs). Returns `{ userContent, engineContent } | null`. Document the Phase 5 payload contract (`{ decision: "approved"|"rejected", answers?, generalNotes?, recordAsDecisions? }` — A1/A2) in the doc comment: single source of truth.

**Import pattern** (lines 16-18): only `EventType` from `@ag-ui/core`, `BaseEvent` from `@ag-ui/client`, `EngineEvent` from `../engine/types.ts`. `translateResumeToSubmission` additionally imports `buildDecisionSubmission` from `../conversation/decision-submission.ts` and `DecisionAnswer` from `../../shared/rpc-types.ts`.

---

### `src/bun/copilotkit/interrupt-registry.ts` (NEW — module-level singleton registry)

**No direct analog** (no module-level singleton exists in the codebase). Two closest patterns to compose:

**State-shape pattern — `TranslateState` + `createTranslateState`** (event-bridge.ts:20-58): per-thread record with counters, produced by a factory, documented with lifecycle caveats:
```typescript
export interface TranslateState {
  threadId: string; runId: string; textSeq: number; reasoningSeq: number; toolSeq: number;
  toolSeqByCall: Map<string, number>; openToolCallIds: string[]; textOpen: boolean; reasoningOpen: boolean;
}
export function createTranslateState(threadId: string, runId: string): TranslateState { ... }
```

**Per-thread keyed store pattern — `JsonlStore`** (jsonl-store.ts:30-91): class with injected deps, defensive validation before side effects, tolerant reads. The registry per CONTEXT discretion lives at MODULE level (survives `cloneAgentForRequest` — Pitfall 4; instance fields on the agent are lost per request):
```typescript
// Registry entry shape (research diagram line 129): Map<threadId, { interruptId, conversationId, executionId, payload, createdAt }>
// - interruptId: `decision-${conversationId}-${seq}` (A3 — stable per decision batch, executionId-independent; Pitfall 3)
// - expiresAt: omitted for v1 (A5 — discretion: no expiry)
// - exported reset() for tests (research recommended structure line 148)
// - lazy rebuild from JSONL tail on restart (A2/Open Question 1): scan store.read(threadId) for the last RUN_FINISHED with outcome.type==="interrupt",
//   correlate executionId from the DB 'waiting_user' executions row — reuse railyin-runner.ts connect() cold-path shape (lines 156-174) as the scanning reference
```

**Methods:** `set/get/clear(threadId)` + `hasOpen(threadId)`; module singleton with `reset()` (test hook — mirrors the beforeEach reset pattern of railyin-agent.test.ts lines 51-85).

---

### `src/bun/copilotkit/railyin-runner.ts` (code UNCHANGED — tests only)

**Analog:** itself. The cold-replay path (lines 149-190) is already verified to preserve interrupt outcomes and `RUN_STARTED.input.resume[]` (research D-08/RUNR-08 — empirical test this session). No code changes; the pattern map is for the new tests:

**Replay-shape sequence to pin** (lines 158-174) — new tests append a RUN_FINISHED with `outcome.interrupt` + a resume run (RUN_STARTED with `input.resume[]`), then assert `connect()` re-emits both verbatim:
```typescript
if (this.store.exists(request.threadId)) {
  const raw = this.store.read(request.threadId) ?? [];
  const firstError = raw.findIndex((e) => e.type === EventType.RUN_ERROR);
  const events = firstError !== -1 ? raw.slice(0, firstError) : raw;
  if (events.length > 0) finalizeRunEvents(events);   // early-returns when a terminal exists
  completeOpenToolCalls(events);
  const compacted = compactEvents(events);            // preserves outcome.interrupt + resume[] (verified)
  ...
}
```

---

### `src/bun/testing/mock-engine.ts` (fake engine, scripted transform)

**Analog:** itself. `SCRIPT_MARKERS` (lines 22-27) + `scriptedEvents` (lines 29-63) + the abort-checked execute loop (lines 69-84). Phase 3 adds a two-phase `__SCRIPT_DECISION__` scenario (research Pattern 4, lines 230-251):

```typescript
const SCRIPT_MARKERS = [
  "__SCRIPT_TOOLS__",
  "__SCRIPT_DANGLING_TOOL__",
  "__SCRIPT_SLOW__",
  "__SCRIPT_ERROR__",
  "__SCRIPT_DECISION__",          // ← NEW
] as const;
```
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
Placement: after the `__SCRIPT_ERROR__` block (line 61), before `return null` (line 62). Phase B proves "engine received the translated decision" because it only fires when the formatted text reached `params.prompt` (the engineContent path). The existing event-shape syntax (token/decision_request payload strings) is copied verbatim from lines 31-61.

---

### Test-file patterns (all four)

**`event-bridge.test.ts`** — copy the contract-validation harness for the new pure helpers:
```typescript
// lines 19-27: every emitted event zod-parsed against the wire contract
function assertValid(events: BaseEvent[]): void {
  for (const event of events) {
    const parsed = EventSchemas.safeParse(event);
    expect(parsed.success).toBe(true);
    ...
  }
}
```
New tests: `buildInterruptOutcome` shape (RUN_FINISHED + outcome.type "interrupt" + reason "decision_request" + metadata=parsed payload, malformed payload → metadata undefined), `translateResumeToSubmission` (valid answers → delegation shape; empty/missing answers → null). Note: `EventSchemas` from `@ag-ui/core` validates the interrupt outcome — the existing "terminal paths" describe block (lines 318-343) is the structural template.

**`railyin-agent.test.ts`** — extend the fake-coordinator harness (lines 51-85) and `collectRun`/`runInput` (lines 18-39):
- `runInput` needs a variant with `resume: [{ interruptId, status, payload }]` (schema: `@ag-ui/core` `RunAgentInput.resume[]` — `{ interruptId: string; status: "resolved"|"cancelled"; payload?: any }`).
- The fake `executeChatTurn` (lines 62-74) drives `onEngineEvent`/`onRunEnd` synchronously — the decision-cycle fake drives `decision_request` then `onRunEnd("decision")`, then the RESUME fake drives the continuation (`token` + `onRunEnd("done")`).
- Test 10 (lines 384-428) shows the execution-row seeding pattern (`INSERT INTO executions ... status='waiting_user'`) — reused for block-while-pending (D-04) and for asserting the resume branch bypasses the lock (Pitfall 1) and closes the orphaned row (Pitfall 2: assert the row's status after resume).
- `collectRun` (lines 18-28) unchanged; the resume validation tests assert `INVALID_INTERRUPT` RUN_ERROR via `events[events.length-1]` `toMatchObject({ code })` (pattern at lines 334-335).

**`railyin-runner.test.ts`** — reuse `ev()` (lines 27-29) and `appendCompletedRun` (lines 73-79) to build the new log shapes: an interrupt-terminal run (RUN_FINISHED with `outcome: { type: "interrupt", interrupts: [...] }`) and a resume run (RUN_STARTED with `input.resume`), then `connect()` and assert verbatim replay (per-run boundaries pattern at test 3c, lines 158-175).

**`e2e/api/copilotkit/railyin.test.ts`** — reuse `postJson`/`parseSseFrames` (lines 34-57), `runInput` (lines 60-70), the `startServer({ mcpConfig: {} })` fixture (lines 21-31), and the restart-replay pattern (test 10, lines 279-311 — `mkdtempSync` durable dir + two servers). New tests 11+ (research line 155): full decision cycle over the real server — run with `__SCRIPT_DECISION__` → assert interrupt-outcome RUN_FINISHED is the LAST frame (normal terminal, not RUN_ERROR — D-03); resume run with `resume[]` + translated payload → assert continuation frames; assert JSONL on disk; block-while-pending (a plain run while pending → THREAD_BUSY, frames end RUN_ERROR); `runInput` gains the `resume` field (keep `forwardedProps: {}` — assert the agent ignores `forwardedProps.command.resume`, Pitfall 6).

---

### `src/bun/engine/coordinator.ts` + `orchestrator.ts` + `human-turn-executor.ts` (A6 seam — planner's call)

**If the additive `opts?: ChatTurnOpts` param is accepted** (A6/Open Question 3 — preserves same-execution engine resume for task-linked threads):

- **coordinator.ts:** `ChatTurnOpts` interface (lines 7-10) is reused as-is; `executeHumanTurn` (line 14) gains `opts?: ChatTurnOpts`:
```typescript
executeHumanTurn(taskId: number, content: string, attachments?: Attachment[], engineContent?: string, opts?: ChatTurnOpts): Promise<{ message: ConversationMessage; executionId: number }>;
```
- **orchestrator.ts:** `executeHumanTurn` wrapper (lines 141-148) passes opts through — mirror the `executeChatTurn` wrapper (lines 163-175), which already ends with `opts?: import("./coordinator.ts").ChatTurnOpts` and forwards it at line 174.
- **human-turn-executor.ts:** `execute` (lines 47-52) gains the param; both `runNonNative` call sites (line 168 — new-execution fallback; line 274 — fresh turn) pass opts. Precedent: `chat-executor.ts:188` (`this.streamProcessor.runNonNative(null, conversationId, executionId, engine, execParams, opts)`).
- **Fallback if rejected:** the resume branch routes task-linked threads through `executeChatTurn` too (works — loses only same-execution engine resume for tasks; A6 notes this).

**`decision-submission.ts` (unchanged):** `buildDecisionSubmission` (lines 17-41) is the translation target — `translateResumeToSubmission` must delegate, never reformat (Don't Hand-Roll row 3; DH-5..DH-10 pin the hidden record_decision instructions). `DecisionAnswer` type lives at `src/shared/rpc-types.ts:322-327`; `DecisionRequestPayload` at `rpc-types.ts:279-282` (the interrupt `metadata` shape).

**Orphaned-row finalize reference (Pitfall 2):** `stream-processor.ts:494-506` — the ONLY writer of `waiting_user` on the decision path:
```typescript
case "decision_request": {
  convBuffer.enqueue({ taskId, conversationId, type: "decision_request_prompt", role: null, content: event.payload, notify: true });
  ...
  db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
  ...
  "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
  ...
  opts?.onRunEnd?.("decision");
}
```
No existing code path closes that chat row (verified — research Pitfall 2); the resume branch owns the finalize.

---

## Shared Patterns

### 1. Error emission — `emitRunError` (RUN_STARTED first, RUN_ERROR with code, complete)
**Source:** `railyin-agent.ts:129-134`
**Apply to:** All resume-validation rejections (D-05: unknown interruptId, partial resume, duplicate resume → `INVALID_INTERRUPT`); the D-04 block stays THREAD_BUSY (unchanged).
```typescript
const emitRunError = (message: string, code?: string): void => {
  subject.next({ type: EventType.RUN_STARTED, threadId, runId, input });
  subject.next({ type: EventType.RUN_ERROR, message, code });
  subject.complete();
  if (this.activeRun === run) this.activeRun = null;
};
```

### 2. Exactly-one-terminal discipline
**Source:** `railyin-agent.ts:193-226` + `event-bridge.ts:311-325`
**Apply to:** The interrupt terminal (D-03/D-06). Same sequence as `finish()`: `terminalEmitted` guard → `translateEngineEvent({type:"done"})` closers → `synthesizeMissingToolResults` → terminal → `subject.complete()` → clear `activeRun`. The bridge NEVER emits the terminal (Pitfall 3; anti-pattern 1).

### 3. Wire-shape validation in tests — `EventSchemas.safeParse`
**Source:** `event-bridge.test.ts:19-27`
**Apply to:** All new tests emitting AG-UI events (interrupt outcome, RUN_STARTED with `resume[]`) — the installed `@ag-ui/core@0.0.57` schemas ARE the contract (RUNR-08).

### 4. Block-while-pending (D-04) + resume bypass
**Source:** advisory lock `railyin-agent.ts:162-168` (block) / resume-branch placement (bypass)
**Apply to:** The resume branch runs BEFORE `extractUserText` (line 149) and BEFORE the lock (line 162); the lock remains the D-04 reject for non-resume runs. Test both directions (Pitfall 1).

### 5. `waiting_user` row finalization (Pitfall 2)
**Source:** `stream-processor.ts:494-506` (writer) — finalize is NEW code in the resume branch
**Apply to:** resolved path → `status='completed'`; cancelled path → `status='cancelled'` (planner's call per research); ALWAYS before/after delivery so the advisory lock never wedges the thread.

### 6. Module-level state with `reset()` for tests
**Source:** NEW pattern (registry); precedent: `beforeEach` fresh-state in `railyin-agent.test.ts:51-85` and `railyin-runner.test.ts:85-93`
**Apply to:** `interrupt-registry.ts` + `interrupt-registry.test.ts` — module singleton survives agent clones (Pitfall 4); `reset()` in beforeEach prevents cross-test leakage.

### 7. Pure helpers delegated to `buildDecisionSubmission`
**Source:** `decision-submission.ts:17-41`; legacy call site `chat-sessions.ts:178-198`
**Apply to:** `translateResumeToSubmission` — never re-format Q/A pairs; the engineContent hidden instructions stay the single source of truth (Don't Hand-Roll row 3).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/bun/copilotkit/interrupt-registry.ts` | store (module-level singleton) | event-driven | No module-level singleton registry exists in the codebase (agent instance fields are the only per-thread state today, and they're lost on clone — Pitfall 4). Compose `TranslateState` (event-bridge.ts:20-58) + `JsonlStore` (jsonl-store.ts:30-91) + the runtime's `ɵGLOBAL_STORE` concept (research lines 44-45). Planner should use the RESEARCH.md design (Pattern 2 sketch lines 178-199, diagram line 129) |

---

## Metadata

**Analog search scope:** `src/bun/copilotkit/`, `src/bun/testing/`, `src/bun/engine/` (orchestrator, coordinator, human-turn-executor, stream-processor, chat-executor), `src/bun/conversation/`, `src/bun/handlers/`, `src/shared/rpc-types.ts`, `e2e/api/copilotkit/`
**Files scanned:** 15 source/test files read in full (all < 450 lines)
**Pattern extraction date:** 2026-08-09
**Baseline:** Phase 2 closed green — 50 copilotkit unit tests, 12 e2e API tests (research line 486)
