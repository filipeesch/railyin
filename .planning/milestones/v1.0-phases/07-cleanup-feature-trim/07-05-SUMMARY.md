---
phase: 07-cleanup-feature-trim
plan: 05
subsystem: api, shared-contract, ui, testing
tags: [legacy-import, env-gate, flag, d-06, d-07, playwright, validation, api-coverage]

# Dependency graph
requires:
  - phase: 07-cleanup-feature-trim
    provides: 07-04's trimmed RPC surface + MessageType, 07-03's store/protocol removal, 07-01/02's zero-write engine — the base the D-07 gate proves
provides:
  - Legacy import retired behind RAILYN_LEGACY_IMPORT=1: legacyImport.run absent by default (404 over the wire), unconditional legacyImport.enabled visibility RPC, ChatThreadSidebar button hidden unless enabled, all 7 e2e/api spawns flagged
  - D-07 post-deletion gate green on all 8 legs with evidence: tripwire 56/0, grep gates zero, build ok, full Playwright 518/8/0, e2e/api 84/0, src/bun 2256/2/0, typecheck clean, mock-agui 23/0
  - 07-VALIDATION.md closed (nyquist_compliant: true, status: closed, wave_0_complete: true, per-task map populated); 07-COVERAGE.md created (detector {"detected":false,"signals":[]} verbatim + no-external-API declaration + A1-A5 assumption log)
  - Zero migrations this phase (schema gate NOT triggered — frozen tables untouched)
affects: [verify-work, gsd-ship, phase-gate review, 06-COVERAGE precedent]

# Actuals (#2632) — pairs with the plan's estimate (30000 tokens).
actuals:
  tokens: 6938        # chars/4 over the realized diff (27753 chars, 10 files)
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Env-gate at handler registration: RAILYN_LEGACY_IMPORT=1 mirrors the RAILYN_COPILOTKIT_PROBE precedent — absent RPC = 404, never an erroring handler"
    - "Type-safe visibility channel: unconditional legacyImport.enabled RPC drives UI affordance (no 404-driven UI, no build-time env)"

key-files:
  created:
    - .planning/phases/07-cleanup-feature-trim/07-COVERAGE.md (API-coverage decision record)
  modified:
    - src/bun/index.ts (legacyImportEnabled const + gated registration)
    - src/bun/handlers/legacy-import.ts (gated run + unconditional enabled RPC)
    - src/shared/rpc-types.ts (legacyImport.enabled entry)
    - src/mainview/components/chat/ChatThreadSidebar.vue (button v-if on enabled)
    - e2e/api/fixtures/server.ts (StartServerOptions.legacyImport)
    - e2e/api/copilotkit/legacy-import.test.ts (7 flagged spawns)
    - e2e/ui/chat-copilotkit.spec.ts (L-3 reworked: hidden-by-default + enabled flow)
    - e2e/ui/fixtures/index.ts (legacyImport.enabled baseline mock)
    - .planning/phases/07-cleanup-feature-trim/07-VALIDATION.md (closed)

key-decisions:
  - "Gate implemented inside legacy-import.ts (handler takes an enabled flag) rather than a conditional spread in index.ts — the RPC map stays a single flat spread; run is present only when enabled, enabled is always registered"
  - "ChatThreadSidebar fetches legacyImport.enabled once on mount and fails CLOSED (hidden) on any RPC error — no import affordance when the flag cannot be confirmed"
  - "D-07 leg 2 grep gate interpreted in fixed-string form: BRE wildcard '.' would false-positive on the frozen stream_events table SQL (migrations/tests, D-04-exempt) and the Anthropic SDK's native stream_event type; literal protocol terms are zero except one comment in the D-04-protected migration 033 (07-03/07-04 precedent — never touched)"

patterns-established:
  - "Retirement-by-flag = registration gate + visibility RPC + flagged test spawns + hidden-by-default UI spec, all in one commit"

requirements-completed: [TRIM-file_diff, TRIM-code_review, TRIM-transition_event, TRIM-status/status_chunk, TRIM-usage display, TRIM-compaction_summary, TRIM-ask_user, TRIM-shell_approval]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Legacy import retired behind RAILYN_LEGACY_IMPORT=1 — legacyImport.run registered only when the flag is set (404 over the wire otherwise); the import module + frozen-table reads stay available"
    verification:
      - kind: integration
        ref: "e2e/api/copilotkit/legacy-import.test.ts (5 pass — all 7 spawns flagged); flag-off wire probe: run 404, enabled {enabled:false}"
        status: pass
    human_judgment: false
  - id: D2
    description: "legacyImport.enabled RPC (unconditional, { enabled: boolean }) drives ChatThreadSidebar button visibility — hidden by default, visible + full toast flow when enabled"
    verification:
      - kind: automated_ui
        ref: "e2e/ui/chat-copilotkit.spec.ts#L-3 (both branches: toHaveCount(0) hidden-by-default; enabled flow with success/idempotent/failure toasts)"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-07 post-deletion gate green on all 8 legs with recorded evidence — the four phase success criteria hold"
    verification:
      - kind: e2e
        ref: "bunx playwright test e2e/ui (518 pass / 8 skip / 0 fail, 42 spec files)"
        status: pass
      - kind: integration
        ref: "bun test e2e/api --timeout 30000 (84 pass / 0 fail)"
        status: pass
      - kind: unit
        ref: "bun test src/bun --timeout 20000 (2256 pass / 2 skip / 0 fail)"
        status: pass
      - kind: other
        ref: "grep gates: protocol + dead-component terms zero (fixed-string); tripwire 56/0; build ok; typecheck clean; mock-agui 23/0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Phase validation contract closed — VALIDATION.md per-task map populated + sign-off, COVERAGE.md detector verbatim + assumption log, zero migrations"
    verification:
      - kind: other
        ref: "git log --oneline -- src/bun/db/migrations (no phase-7 commits); node api-coverage.cjs --json → {\"detected\":false,\"signals\":[]}"
        status: pass
    human_judgment: false

# Metrics
duration: 48min
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 5: Legacy import retirement + D-07 full gate + phase close-out Summary

**The legacy import path is retired behind the RAILYN_LEGACY_IMPORT=1 env gate (D-06): `legacyImport.run` is absent by default (404 over the wire), the unconditional `legacyImport.enabled` RPC hides the sidebar import button unless enabled, all 7 e2e/api spawns carry the flag, and the L-3 UI spec now proves both branches — then the full 8-leg D-07 gate goes green end-to-end (tripwire 56, grep zero, build ok, Playwright 518/8/0, e2e/api 84, src/bun 2256/2/0, typecheck clean, mock-agui 23) and the phase's verification contract closes (VALIDATION sign-off + COVERAGE decision record, zero migrations).**

## Performance

- **Duration:** 48 min
- **Started:** 2026-08-09T22:10:00Z
- **Completed:** 2026-08-09T22:58:00Z
- **Tasks:** 3
- **Files modified:** 10 (172 insertions, 45 deletions)

## Accomplishments

- **Task 1 — Legacy import retirement behind the flag** (`8a84a0a1`): `src/bun/index.ts` gains `const legacyImportEnabled = process.env.RAILYN_LEGACY_IMPORT === "1"` (the RAILYN_COPILOTKIT_PROBE precedent) and passes it into `legacyImportHandlers`; `legacy-import.ts` returns the **unconditional** `legacyImport.enabled` RPC (`{ enabled: boolean }`) and registers `legacyImport.run` **only when enabled** — absent RPC = 404, never an erroring handler. `rpc-types.ts` declares `legacyImport.enabled` beside `legacyImport.run` (which stays declared — it is simply unregistered when the flag is off). ChatThreadSidebar fetches `legacyImport.enabled` on mount and binds the import button with `v-if` (fail-closed: any RPC error → hidden); the toast flow stays for the enabled case. Test infra: `StartServerOptions.legacyImport` option → `RAILYN_LEGACY_IMPORT=1` extraEnv; all **7** spawn sites in legacy-import.test.ts flagged (plan said 5 — line drift, all spawns exercise the RPC); fixtures baseline `legacyImport.enabled → { enabled: false }`; L-3 reworked into a two-branch spec (hidden-by-default via `toHaveCount(0)`, then enabled mock + reload + full success/idempotent/failure flow). Acceptance verified: typecheck clean, build ok, **flag-off probe: run 404 + enabled {enabled:false}**, **flag-on probe: enabled {enabled:true} + run works**, flagged suite **5/5 pass**, chat-copilotkit **16/16 pass incl. L-3**, `rg RAILYN_LEGACY_IMPORT src e2e` limited to the gate/RPC/fixture/spawns.
- **Task 2 — D-07 post-deletion gate, 8 legs** (no code change — all green on the Task-1 state; results recorded): 1) tripwire chat-copilotkit+board+board-ws-updates **56/56** (14.3s); 2) grep gates — dead-component terms **zero** in src/mainview; protocol terms **zero** in fixed-string form (the only hit is one comment in the D-04-protected migration `033_stream_events_exec_index.ts` naming the old `getStreamEventsByConversation` API — the documented 07-03/07-04 carve-out, never touched); 3) `bun run build` ok (17.99s); 4) full Playwright **518 pass / 8 skip / 0 fail** (1.7m, 42 spec files — baseline held, L-3 rework kept the count); 5) e2e/api **84 pass / 0 fail** (112.88s — unchanged); 6) src/bun **2256 pass / 2 skip / 0 fail** (50.11s — new count, was 2254); 7) typecheck clean; 8) mock-agui **23/0** (94ms). The 8 Playwright skips (interview-me A6-gap) and 2 src/bun skips are pre-existing intentional — flagged for the phase-gate reviewer per 06-SUMMARY.
- **Task 3 — Phase close-out** (`95c54b5e`): 07-VALIDATION.md closed — per-task verification map fully populated (07-01..07-05 rows all green with commands), Wave 0 requirements complete, both manual-only verifications resolved (A2/A3 blocking checkpoints), sign-off checklist complete, frontmatter `nyquist_compliant: true`, `status: closed`, `wave_0_complete: true`. 07-COVERAGE.md created: detector re-run output verbatim (`{"detected":false,"signals":[]}` — matches planning-time), no-external-API declaration (zero packages/keys/hosts; page.route mocks; e2e/api the single real-server layer), assumption-delta log A1–A5 (**A1 CONFIRMED** — session-status push built in 07-01; **A2 DECIDED** — 07-01 checkpoint option-a DROP; **A3 DECIDED** — 07-02 checkpoint option-a auto-approve; **A4 CONFIRMED** — enabled-RPC channel; **A5 CONFIRMED** — compact RPCs removed in 07-04 with no live callers), no deltas fired. Schema gate: **NOT triggered** — `git log --oneline -- src/bun/db/migrations` shows zero phase-7 commits.

## Task Commits

Each task was committed atomically:

1. **Task 1: Legacy import retirement behind the flag (D-06)** - `8a84a0a1` (feat)
2. **Task 2: D-07 post-deletion gate — full 8-leg sequence** - no commit (pure verification task — all 8 legs green on first run, no code change required)
3. **Task 3: Phase close-out — VALIDATION sign-off + COVERAGE decision record** - `95c54b5e` (docs)

**Plan metadata:** pending (docs commit after SUMMARY)

## Files Created/Modified

- `src/bun/index.ts` - legacyImportEnabled const (probe precedent) + flag passed to legacyImportHandlers
- `src/bun/handlers/legacy-import.ts` - unconditional legacyImport.enabled + flag-gated legacyImport.run; module + reads untouched
- `src/shared/rpc-types.ts` - legacyImport.enabled entry added beside legacyImport.run
- `src/mainview/components/chat/ChatThreadSidebar.vue` - import button v-if-bound to legacyImportEnabled (fetched on mount, fail-closed); toast flow kept
- `e2e/api/fixtures/server.ts` - StartServerOptions.legacyImport option (extraEnv RAILYN_LEGACY_IMPORT=1)
- `e2e/api/copilotkit/legacy-import.test.ts` - all 7 spawns flagged (plan listed 5 — drift), docstring updated
- `e2e/ui/chat-copilotkit.spec.ts` - L-3 reworked: hidden-by-default branch + enabled flow (both in one test — count unchanged)
- `e2e/ui/fixtures/index.ts` - legacyImport.enabled baseline mock (default false)
- `.planning/phases/07-cleanup-feature-trim/07-VALIDATION.md` - closed (nyquist sign-off)
- `.planning/phases/07-cleanup-feature-trim/07-COVERAGE.md` - created (API-coverage decision record)

## Decisions Made

- **Gate placement:** implemented inside `legacy-import.ts` (handler takes the `enabled` flag) instead of a conditional spread at the index.ts call site — the plan allowed either; this keeps the composition root's handler map a single flat spread and the gate logic next to the RPC it guards.
- **Fail-closed visibility:** ChatThreadSidebar defaults the button to hidden and only reveals it on a successful `legacyImport.enabled` → `{ enabled: true }` — no import affordance when the flag cannot be confirmed (never 404-driven).
- **7 spawns not 5:** the plan's spawn list (:93,:143,:188,:250,:284) predates the crash-tolerance suite additions — the file now has 7 spawn sites and all 7 exercise `legacyImport.run`, so all 7 were flagged (any unflagged spawn would 404).
- **D-07 grep gate in fixed-string form:** the plan's BRE pattern treats `.` as a wildcard, which false-positives on the frozen `stream_events` table SQL in migrations/tests (D-04-exempt — the table name is not the deleted protocol) and the Anthropic SDK's native lowercase `stream_event` event type (live translation surface). Run as fixed-string literals, the gate is zero except one comment in the D-04-protected migration 033 — the exact carve-out 07-03/07-04 documented. This is the same interpretation prior plans used.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan's spawn list (5) was stale — 7 spawn sites in the test file**
- **Found during:** Task 1 (before edits, spawn-site enumeration)
- **Issue:** The plan enumerated 5 spawn sites (:93,:143,:188,:250,:284) but the file has 7 (`startServer({ dataDir, durableDb: true })` at :93, :143, :156, :188, :213, :250, :284) — the crash-tolerance suite (A/B/C tests) grew the file after the plan was written. Any unflagged spawn would 404 on `legacyImport.run` and fail the suite.
- **Fix:** Flagged all 7 spawns (perl replace across the file).
- **Files modified:** e2e/api/copilotkit/legacy-import.test.ts
- **Verification:** flagged suite 5/5 pass; flag-on/off wire probes correct
- **Committed in:** 8a84a0a1 (Task 1)

**2. [Rule 3 - Blocking] D-07 grep leg 2 BRE wildcard false-positives**
- **Found during:** Task 2 gate run
- **Issue:** The plan's `git grep "StreamEvent\|stream.event\|..."` BRE pattern treats `.` as a wildcard: `stream.event` matches `stream_events` (table SQL in migrations + retention/tests — D-04-exempt frozen table, not the deleted protocol) and `stream event` prose, and `stream.error`-adjacent matches hit the Anthropic SDK's native `stream_event` case (claude/events.ts:176 — live SDK translation surface). Literal zero was unattainable without renaming a frozen table.
- **Fix:** Re-ran the gate with fixed-string semantics (`git grep -F` per literal term): protocol terms `stream.event`/`stream.error`/`message.new`/`stream-tree`/`StreamEventType` are **zero**; `StreamEvent` has exactly one hit — a comment in the D-04-protected migration `033_stream_events_exec_index.ts:6` (names the old `getStreamEventsByConversation` API) — the documented carve-out from 07-03/07-04 ("never touched"). Recorded the leg as pass with the exemption; no code change (touching a migration would violate D-04).
- **Files modified:** none (documentation only)
- **Verification:** fixed-string gate zero; dead-component grep zero
- **Committed in:** (recorded in SUMMARY, no commit needed)

---

**Total deviations:** 2 auto-fixed (2 blocking — 1 code fix, 1 gate-interpretation correction)
**Impact on plan:** The spawn-list fix was required for the flagged suite to pass; the grep interpretation matches the phase's established D-04 carve-out precedent and required no code change. No scope creep; all acceptance criteria met.

## Issues Encountered

- None — Task 1's acceptance verifications (typecheck, build, wire probes, flagged suite, L-3 spec) all passed on first run; Task 2's 8 legs were all green on the Task-1 state; Task 3's checks (migration log, detector) were clean.

## User Setup Required

None - no external service configuration required. (New env var `RAILYN_LEGACY_IMPORT` is a local behavior gate — unset by default, which is the retired state; only a future migration would set it.)

## Next Phase Readiness

- **Phase 7 is complete:** import retired behind the flag, D-07 gate green on all 8 legs with counts recorded, VALIDATION closed, COVERAGE decision recorded, assumption log reconciled, zero migrations.
- **All four phase success criteria hold:** (1) no trimmed features visible — full Playwright green, import button hidden by default; (2) zero new writes to frozen tables — 07-01's INSERT gate + smoke frozen-table proofs; (3) zero protocol references + green suites — leg 2 grep + legs 1-8; (4) import retired behind the flag — Task 1.
- **Watch items for the phase-gate reviewer:** the 8 Playwright skips (interview-me A6-gap — interrupt payload fixture knob decision per 06-SUMMARY) and 2 src/bun skips are pre-existing intentional; `tasks.getFileDiff` remains a live review-overlay RPC (07-04 documented deviation — must not be flagged as a trim straggler).
- Ready for `/gsd-verify-work` + phase-gate review; milestone close-out (IMPR-03 rollback window closed by Phase 6) is the next milestone step.

---

*Phase: 07-cleanup-feature-trim*
*Completed: 2026-08-09*

## Self-Check: PASSED

- SUMMARY.md exists at `.planning/phases/07-cleanup-feature-trim/07-05-SUMMARY.md` ✓
- Task 1 commit `8a84a0a1` exists ✓
- Task 3 commit `95c54b5e` exists ✓
- All 3 plan tasks executed (Task 2 = pure verification gate, no commit needed) ✓
- bun run typecheck exit 0 ✓
- bun run build ok ✓
- Flag-off wire probe: legacyImport.run 404, legacyImport.enabled {enabled:false} ✓
- Flag-on wire probe: legacyImport.enabled {enabled:true}, run works ✓
- bun test e2e/api/copilotkit/legacy-import.test.ts 5 pass / 0 fail ✓
- chat-copilotkit.spec.ts 16 pass / 0 fail incl. L-3 both branches ✓
- D-07 leg 1: tripwire 56 pass / 0 fail ✓
- D-07 leg 2: grep gates zero (fixed-string; only D-04-protected migration comment) ✓
- D-07 leg 3: build ok ✓
- D-07 leg 4: full Playwright 518 pass / 8 skip / 0 fail ✓
- D-07 leg 5: e2e/api 84 pass / 0 fail ✓
- D-07 leg 6: src/bun 2256 pass / 2 skip / 0 fail (new count) ✓
- D-07 leg 7: typecheck clean ✓
- D-07 leg 8: mock-agui 23 pass / 0 fail ✓
- git log -- src/bun/db/migrations: zero phase-7 commits (schema gate NOT triggered) ✓
- api-coverage detector: {"detected":false,"signals":[]} verbatim ✓
- 07-VALIDATION.md frontmatter: nyquist_compliant true / status closed / wave_0_complete true ✓
- 07-COVERAGE.md exists with detector JSON + declaration + assumption log ✓
