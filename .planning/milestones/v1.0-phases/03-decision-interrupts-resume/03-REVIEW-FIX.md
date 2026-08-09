---
phase: 03-decision-interrupts-resume
fixed_at: 2026-08-09T00:03:00Z
review_path: .planning/phases/03-decision-interrupts-resume/03-REVIEW.md
iteration: 1
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report — Decision Interrupts & Resume

**Fixed at:** 2026-08-09T00:03:00Z
**Source review:** `.planning/phases/03-decision-interrupts-resume/03-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 11 (1 critical, 7 warnings, 3 info)
- Fixed: 11
- Skipped: 0

## Fixed Issues

### CR-01: Double `RUN_STARTED` in the INVALID_PAYLOAD resume path breaks the stream for spec-compliant clients

**Files modified:** `src/bun/copilotkit/railyin-agent.ts`, `src/bun/copilotkit/railyin-agent.test.ts`
**Commits:** `6bdfaa73`
**Applied fix:** Restructured the resume branch so all rejection paths precede the single `RUN_STARTED` emission: the payload translation (`translateResumeToSubmission` → `INVALID_PAYLOAD`) and the workspace-key resolution (`THREAD_NOT_FOUND`) now run before `subject.next(RUN_STARTED)`, mirroring the main path's pre-validation shape (IN-03). The cancelled branch emits its own single `RUN_STARTED` + `RUN_FINISHED` (unchanged wire behavior). Test R8 now asserts exactly one `RUN_STARTED` on the INVALID_PAYLOAD path.

### WR-01: `decision_request` terminal drops accumulated tokens/reasoning from the persisted conversation

**Files modified:** `src/bun/engine/stream/stream-processor.ts`, `src/bun/test/execution-seam.test.ts`
**Commit:** `c7d8707b`
**Applied fix:** The `decision_request` case now flushes `reasoningAccum`/`tokenAccum` into `convBuffer` (with matching `onStreamEvent` broadcasts) before enqueueing the `decision_request_prompt`, mirroring the `done` case — the assistant text preceding a decision is persisted to `conversation_messages`. New seam test 3e asserts the assistant message is persisted and ordered before the decision prompt.

### WR-02: `ensureOpen` rebuilds a stale interrupt when no `waiting_user` row exists — re-opens already-resolved decisions after restart

**Files modified:** `src/bun/copilotkit/interrupt-registry.ts`, `src/bun/copilotkit/interrupt-registry.test.ts`
**Commit:** `6412fc2e`
**Applied fix:** `ensureOpen` now requires the durable `waiting_user` executions row as a liveness check — an interrupt terminal in the JSONL without the row (decision already resumed/cancelled) returns `null`, so the resume rejects cleanly with `INVALID_INTERRUPT` instead of resurrecting a closed decision and re-delivering answers (duplicate `record_decision` side effects). New registry test C3 covers the stale-rebuild rejection and the row-presence rebuild.

### WR-03: Resume delivery lacks the `executionId === -1` guard — Pi pre-flight fail-fast hangs the SSE stream

**Files modified:** `src/bun/copilotkit/railyin-agent.ts`, `src/bun/copilotkit/railyin-agent.test.ts`
**Commit:** `14b80bde`
**Applied fix:** The resume `.then` now mirrors the main path: `executionId === -1` → `guardedComplete()` (RUN_FINISHED terminal) instead of hanging the SSE stream. The registry entry stays open so the decision remains retryable once the engine config is fixed. New test R10 asserts the stream completes with exactly one terminal and one RUN_STARTED.

### WR-04: Resume `.then` `clear()` can wipe a continuation interrupt registered synchronously

**Files modified:** `src/bun/copilotkit/railyin-agent.ts`, `src/bun/copilotkit/railyin-agent.test.ts`
**Commit:** `6daf7b8d`
**Applied fix:** The `.then` clear is now guarded on the pending entry still holding the *original* interrupt id (`pending?.interruptId === open.interruptId`) — a continuation `decision_request` registered synchronously inside delivery (new id) survives the hook, preserving the D-05 dedup contract. New test R11 drives a synchronous continuation and asserts the fresh entry is not cleared.

### WR-05: Malformed resume answers crash `buildDecisionSubmission` instead of yielding `INVALID_PAYLOAD`

**Files modified:** `src/bun/copilotkit/event-bridge.ts`, `src/bun/copilotkit/event-bridge.test.ts`, `src/bun/copilotkit/railyin-agent.test.ts`
**Commit:** `a33c4468`
**Applied fix:** `translateResumeToSubmission` validates every answer element before delegation — null elements, non-objects, non-string `question`/`answer`, non-string `weight` (the `.toUpperCase()` crash), and non-string `generalNotes` (the `.trim()` crash) all return `null` → the agent emits `INVALID_PAYLOAD` (ASVS L1). New unit test 3a covers the malformed shapes; agent test R12 proves `weight: 123` yields `INVALID_PAYLOAD` with no executor call, no crash, and exactly one `RUN_STARTED`.

### WR-06: Prompt injection via decision answer payloads — answers are concatenated into the engine prompt next to the hidden instruction

**Files modified:** `src/bun/conversation/decision-submission.ts`, `src/bun/copilotkit/event-bridge.test.ts`
**Commits:** `e4768570`, `ee7e4e62`
**Applied fix:** The Q/A block is wrapped in a structured `<decision_answers>…</decision_answers>` container and all client-controlled text (questions, answers, notes, general notes) is angle-bracket-escaped (`<`/`>` → entities) so a crafted answer cannot close the container early and inject instructions adjacent to the hidden `record_decision` instruction. The sanitizer coerces via `String()` to preserve pre-sanitizer template-literal behavior for direct callers (resume shapes are validated upstream by WR-05). New bridge test proves an injected `</decision_answers>` is escaped and the container stays intact.

### WR-07: `buildInterruptOutcome` emits schema-invalid `metadata` when the payload parses to a non-object

**Files modified:** `src/bun/copilotkit/event-bridge.ts`, `src/bun/copilotkit/event-bridge.test.ts`
**Commit:** `9060c8fa`
**Applied fix:** `buildInterruptOutcome` accepts a parsed payload as `metadata` only when it is a plain object (not number/boolean/string/array/null) — matching `InterruptSchema`'s `metadata: z.record(z.any())`. Non-object parses fall through to the message fallback with `metadata` omitted. New bridge test round-trips `"42"`, `"true"`, `'["a","b"]'`, `'"str"'`, `"null"` and asserts wire validity via `EventSchemas`.

### IN-01: `anyEventSeen` is assigned but never read

**Files modified:** `src/bun/copilotkit/railyin-agent.ts`
**Commit:** `0fa14930`
**Applied fix:** Removed the dead `anyEventSeen` variable, its stale WR-02 comment, and both assignments (the real completion guard is the `queueMicrotask` closure).

### IN-02: Duplicate resume entries with the same interruptId pass `allResolved`

**Files modified:** `src/bun/copilotkit/railyin-agent.ts`, `src/bun/copilotkit/railyin-agent.test.ts`
**Commit:** `0fa14930`
**Applied fix:** `allResolved` now requires `new Set(resumeIds).size === resumeIds.length` — duplicate entries for one interrupt reject with `INVALID_INTERRUPT` (deterministic resolution; `find()` no longer silently drops a conflicting second payload). New test R13 covers it.

### IN-03: HumanTurnExecutor fallback overwrites the agent-finalized `completed` row with `failed`

**Files modified:** `src/bun/engine/execution/human-turn-executor.ts`, `src/bun/test/execution-seam.test.ts`
**Commits:** `db62f400`, `cc60de93`
**Applied fix:** Two status filters in the waiting_user branch: (1) the optimistic flip `UPDATE executions SET status='running'` now requires `AND status='waiting_user'` — it no longer resurrects a row the AG-UI resume branch already finalized to `completed` (which would also block the advisory lock forever); (2) the catch's `failed` update targets `status='running'` (the state the flip leaves on genuinely-waiting rows) so a pre-finalized row keeps its truthful `completed` terminal while the ask_user-session-lost case still records `failed`. New seam test 4 asserts the `completed` row is untouched; the existing seam test 3 (genuine `waiting_user` → `failed`) still passes.

## Verification

All gates ran in the **main checkout** (after the worktree fast-forward — no `node_modules` in the isolated worktree):

| Gate | Command | Result |
|---|---|---|
| Copilotkit unit | `bun test src/bun/copilotkit --timeout 20000` | 93 pass / 0 fail |
| Execution seam | `bun test src/bun/test/execution-seam.test.ts --timeout 20000` | 11 pass / 0 fail |
| API e2e | `bun test e2e/api/copilotkit --timeout 30000` | 35 pass / 0 fail |
| Typecheck | `bun run typecheck` | clean |

No findings were skipped or deferred.

---

_Fixed: 2026-08-09T00:03:00Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
