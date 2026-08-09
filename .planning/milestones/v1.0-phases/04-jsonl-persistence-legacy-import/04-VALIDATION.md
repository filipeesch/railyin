---
phase: 4
slug: jsonl-persistence-legacy-import
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-09
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Completed by 04-03 Task 2: per-task verification map ticked across all three
> plans, Wave 0 checklist checked, open-question resolutions + assumption-delta
> advisory recorded, sign-off approved. All suites green at phase close
> (2026-08-09): backend 2389 pass / 2 skip, e2e/api 82 pass, typecheck 0 errors.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest under `bun test` (backend) + bun:test (e2e/api) |
| **Config file** | `vitest.backend.config.ts`, `vitest.config.ts` |
| **Quick run command** | `bun test src/bun/copilotkit --timeout 20000` + `bun test e2e/api/copilotkit/legacy-import.test.ts --timeout 30000` (per-file commands in the map below) |
| **Full suite command** | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` |
| **Estimated runtime** | ~2 minutes (actual ~3 min at phase close — 58s backend + 112s e2e incl. restart-replay accommodations) |

---

## Sampling Rate

- **After every task commit:** Run the phase's unit tests (`bun test src/bun/copilotkit --timeout 20000`)
- **After every plan wave:** Full suite (above)
- **Before `/gsd-verify-work`:** Full suite must be green — **DONE (see below)**
- **Max feedback latency:** ~2 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01 T1 | 01 | 1 | CHAT-08 | T-04-01..03 | threads.list slice: store.list() THREAD_ID_RE-filtered scan + threadsHandlers DB join + registration; e2e session/card listing + restart-from-disk | e2e | `bun test e2e/api/copilotkit/threads.test.ts --timeout 30000` | ✅ | ✅ green — 3/3 |
| 04-01 T2 | 01 | 1 | CHAT-08 | T-04-04 | list() unit cases (scan/filter/sort/missing-dir/decoys/partial-line tolerance) + handler enrichment/orphan/empty-store | unit | `bun test src/bun/copilotkit/jsonl-store.test.ts --timeout 20000 && bun test src/bun/test/threads-handlers.test.ts --timeout 20000` | ✅ | ✅ green — 7/7 |
| 04-02 T1 | 02 | 2 | IMPR-01, IMPR-02 | T-04-05, T-04-08 | Import slice: buildThreadLog + runLegacyImport + importLog atomic tmp+rename + handler + registration; wire import shape, idempotent re-run, frozen counts | integration | `bun test e2e/api/copilotkit/legacy-import.test.ts --timeout 30000` | ✅ | ✅ green — 2/2 |
| 04-02 T2 | 02 | 2 | IMPR-01, IMPR-02 | T-04-06, T-04-07, T-04-09, T-04-10 | Mapping matrix + per-run namespacing + dangling-tool synthesis + timestamp pin + idempotency/atomicity + lifecycle scan + frozen counts; e2e restart replay | unit/e2e | `bun test src/bun/copilotkit/import.test.ts --timeout 20000 && bun test e2e/api/copilotkit/legacy-import.test.ts --timeout 30000` | ✅ | ✅ green — 10/10 + 2/2 |
| 04-03 T1 | 03 | 3 | CHAT-08, IMPR-01 | T-04-11, T-04-12 | Crash tolerance e2e: partial-tail list+replay across restart (A), .tmp decoy invisibility + final-file marker honesty (B), re-import after crash artifact (C) | integration | `bun test e2e/api/copilotkit/legacy-import.test.ts --timeout 30000` | ✅ | ✅ green — 5/5 |
| 04-03 T2 | 03 | 3 | phase gate | T-04-13 | Full backend + e2e suites + typecheck green in one pass; COVERAGE.md decision record + VALIDATION.md sign-off | full suite | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` | — | ✅ green — 2389 pass / 2 skip; 82 pass; 0 errors |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — commands carry no `-x` flag (invalid on bun 1.4.0).*

---

## Wave 0 Requirements

All four Wave 0 gaps from 04-RESEARCH.md §Validation Architecture are now phase deliverables:

- [x] `src/bun/copilotkit/import.test.ts` — mapping/grouping/idempotency/atomicity unit suite (created by 04-02 T2)
- [x] `src/bun/copilotkit/jsonl-store.test.ts` — `list()` cases: scan/filter/sort/missing-dir/decoys/partial-line crash tolerance (extended by 04-01 T2)
- [x] Handler tests — `src/bun/test/threads-handlers.test.ts` (threads.list enrichment/orphan/empty; legacyImport.run covered by import.test.ts idempotency + the e2e) (04-01 T2, 04-02)
- [x] `e2e/api/copilotkit/legacy-import.test.ts` — seeded legacy DB → import → restart replay (04-02 T1/T2) + crash tolerance (04-03 T1)
- Framework install: none — vitest/bun test already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None — all phase behaviors automated | — | — | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 2min
- [x] `nyquist_compliant: true` set in frontmatter
- [x] Open-question resolutions recorded (04-RESEARCH.md → implemented):
  - Q1 (run grouping granularity) → **RESOLVED** — per-user-message grouping for v1, one synthetic run per user message (04-02 T2 mapping matrix; `stream_events` left as optional enrichment)
  - Q2 (name source: DB join vs sidecar) → **RESOLVED** — DB join only, no sidecar (04-01 T2 threads-handlers enrichment tests; sidecar deferred until v2 mutations)
  - Q3 (paged vs single-shot import) → **RESOLVED** — single-shot `legacyImport.run` returning `{total, imported, skipped, failed, errors}` (04-02 T1/T2)
  - Q4 (exclude archived sessions?) → **RESOLVED** — all threads returned in v1 (04-01 e2e lists session + card without status filtering; Phase 5 filters if desired)
- [x] Assumption-delta advisory (04-RESEARCH.md §Assumptions Log):
  - **A1 (appendFileSync partial-line atomicity)** — no delta needed, but the assumption is now **e2e-PROVEN** rather than reasoned: 04-03 Test A simulates an interrupted append (truncated trailing JSON line) and proves the tolerant reader skips the partial tail while the thread still lists and cold-replays. No other assumptions fired (A2-A7 unchanged).

**Approval:** approved — phase gate green 2026-08-09 (backend 2389 pass / 2 skip, e2e 82 pass, typecheck 0 errors)
