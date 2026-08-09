---
phase: 7
slug: cleanup-feature-trim
status: closed
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-09
closed: 2026-08-09
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest under `bun test` (backend) + Playwright (UI) + bun:test (e2e/api) |
| **Config file** | `vitest.backend.config.ts`, `playwright.config.ts` |
| **Quick run command** | `bun test src/bun --timeout 20000` (backend core) |
| **Full suite command** | `bun run build && bun run test:e2e` + `bun test e2e/api --timeout 30000` + `bun test src/bun --timeout 20000` + `bun run typecheck` |
| **Estimated runtime** | ~17 min e2e + ~2 min backend |

---

## Sampling Rate

- **After every task commit:** Targeted unit tests (`bun test src/bun --timeout 20000` + affected frontend units)
- **After every plan wave:** Build + backend + affected e2e/api + affected Playwright specs
- **Before `/gsd-verify-work`:** Full suite must be green (517/0 baseline must hold after deletion)
- **Max feedback latency:** ~17 minutes — held (longest single leg: e2e/api 112.88s; full Playwright 1.7m; D-07 8-leg sequence complete)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-T1/2/4 | 01 | 1 | Trim items | — | consume() rewrite: zero new writes to old tables | unit + grep | `bun test src/bun --timeout 20000` + INSERT grep gate (zero outside tests/migrations) | ✅ | ✅ 07-01: INSERT grep zero; smoke frozen-table proofs (row counts unchanged after runs) |
| 07-01-T1/4 | 01 | 1 | — | — | notifyChatSessionUpdated push (sidebar freeze fix) | unit/e2e | `bun test src/bun/test/execution-seam.test.ts` + smoke chatSessions lifecycle | ✅ | ✅ 07-01: execution-seam 4/5 (fires on done, not task-bound runs); smoke session status idle after run |
| 07-02-T1/3/4 | 02 | 2 | Trim items | — | Engine emitter trims + A3 shell posture (no invisible hang) | unit + grep | `bun run typecheck` + grep gates (BashPermissionGate/FileStateCache/writtenFiles/waitForResume zero) | ✅ | ✅ 07-02: typecheck exit 0; grep gates zero; opencode answers permissions deterministically (A3 checkpoint option-a) |
| 07-03-T1 | 03 | 3 | Trim items | — | Dead stack deletion (verified-zero files) | grep + build | `git grep` (component + module terms) + `bun run build` | ✅ | ✅ 07-03: per-file grep proofs; terms zero in src/mainview + src/e2e; build ok |
| 07-03-T3 | 03 | 3 | Trim items | — | Protocol type removal + fixture strips + session-status spec | e2e + unit | D-07 grep gate + full Playwright | ✅ | ✅ 07-03: gate zero (only D-04 migration comment); 518/8/0 incl. new CD-C-1b |
| 07-04-T1/2/3 | 04 | 3 | Trim items | — | RPC trim (contextUsage/compact/respondShellApproval) + handler removals | grep + unit | trim grep gate + `bun test src/bun/test/handlers.test.ts` | ✅ | ✅ 07-04: gate zero over removed terms; handlers 44 pass; getFileDiff kept (live review overlay) |
| 07-05-T1 | 05 | 4 | Trim items | T-07-40 | Import flag retirement: legacyImport.run registered ONLY with RAILYN_LEGACY_IMPORT=1 (absent → 404); legacyImport.enabled unconditional | e2e | `RAILYN_LEGACY_IMPORT=1` spawn test (e2e/api/copilotkit/legacy-import.test.ts) | ✅ | ✅ 07-05: 5/5 flagged spawns; flag-off 404 + enabled=false verified over the wire; L-3 both branches green |
| 07-05-T2 | 05 | 4 | Trim items | T-07-42 | Post-deletion full gate (517/0 baseline) | all | 8-leg D-07 gate: tripwire → grep → build → full Playwright → e2e/api → src/bun → typecheck → mock-agui | ✅ | ✅ 07-05: 8/8 legs green — tripwire 56, grep zero (D-04 comment exempt), build ok, Playwright 518/8/0, e2e/api 84/0, src/bun 2256/2/0, typecheck clean, mock-agui 23/0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Baseline full-suite run captured (517 pass / 8 skip / 0 fail — Phase 6 gate; current phase baselines: 518/8/0 Playwright, 84 e2e/api, 2254→2256 src/bun, mock-agui 23) — recorded in 06-SUMMARY + per-wave summaries
- [x] Deletion inventory verified via grep (researcher's inventory is the guide) — per-file grep proofs re-run across 07-02/07-03 deletions; every CONTEXT-listed file verified before deletion (FileDiff/ReadView correction applied)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Status |
|----------|-------------|------------|-------------------|--------|
| Failure-toast replacement decision (drop vs new push) | Trim | Product decision | RESEARCH open question — human checkpoint | ✅ RESOLVED 07-01 Task 3 (blocking checkpoint, option-a DROP) — notifications.onError no-op; RUN_ERROR + board execution_state='failed' cover failure UX |
| opencode shell-approval posture (auto-approve vs deny) | Trim | Security-relevant | RESEARCH open question — human checkpoint | ✅ RESOLVED 07-02 Task 2 (blocking checkpoint, option-a auto-approve via shellState.shellAutoApprove; deterministic deny otherwise) |

*Both decision checkpoints resolved with recorded user choices; everything else automated.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 17min
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Approved 2026-08-09 — phase validation contract closed
