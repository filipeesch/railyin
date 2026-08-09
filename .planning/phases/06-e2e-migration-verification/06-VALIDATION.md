---
phase: 6
slug: e2e-migration-verification
status: closed
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-09
closed: 2026-08-09
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (UI e2e, `bun run test:e2e` = build + full suite) + vitest/bun:test (backend) |
| **Config file** | `playwright.config.ts`, `vitest.backend.config.ts` |
| **Quick run command** | `bun run test:e2e:chat` (chat specs) or targeted `bunx playwright test <spec>` |
| **Full suite command** | `bun run test:e2e` (build + all Playwright) + `bun test e2e/api --timeout 30000` + `bun test src/bun --timeout 20000` + `bun run typecheck` |
| **Estimated runtime** | ~17 minutes (full e2e suite) + ~2 min backend |

---

## Sampling Rate

- **After every task commit:** Run the migrated/retired spec set (`bunx playwright test <migrated-specs>`)
- **After every plan wave:** Full Playwright suite
- **Before `/gsd-verify-work`:** Full suite must be green (D-05 gate)
- **Max feedback latency:** ~17 minutes for full suite; seconds per-spec

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-02-T1/T2 | 01 | 1 | VERF-02 | T-06-06..09 | Retire removed-feature specs (code-verified) | grep + Playwright | `bunx playwright test <retired>` absent | ✅ | ✅ green |
| 06-03..06-06 | 02 | 2 | VERF-02 | — | Migrate chat-surface specs onto mock foundation | Playwright | `bunx playwright test <migrated>` | ✅ | ✅ green |
| 06-01-T1 | 02 | 2 | VERF-02 | — | MockAgui multi-message replay knob + tests | unit | `bun test e2e/ui/fixtures --timeout 20000` | ✅ | ✅ green |
| 06-07-T1 | 03 | 3 | VERF-02, VERF-03 | T-06-27..30 | Full-suite green gate | Playwright + backend | `bun run test:e2e` + `bun test e2e/api` + `bun test src/bun` + `bun run typecheck` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Close-out (2026-08-09):** all four rows green on the D-05 gate run — build ✓, full Playwright suite 517 pass / 8 skip / 0 fail / 0 did-not-run across 42 spec files, `e2e/api` 82 pass, `src/bun` 2396 pass / 2 skip / 0 fail, typecheck clean, mock-agui self-tests 23/23. The 8 Playwright skips are the documented interview-me A6-gap skips (06-05); the 2 src/bun skips are pre-existing (planning baseline).

---

## Wave 0 Requirements

- [x] Baseline: full-suite run captured (408 pass / 301 fail / 4 not-run) — RESEARCH.md §Baseline
- [x] MockAgui multi-message replay knob + mock-agui.test.ts cases (06-01, 19 → 23 tests)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Retire-list confirmation (11 whole files) | VERF-02 | Destructive (file deletion) — human checkpoint per RESEARCH Q1 | Confirm each retired spec tests a feature removed in Phase 5 (code-verified rationale in plan) |

*One retire checkpoint per file (blocking-human); everything else automated.*

**Close-out (2026-08-09):** both retire batches (A: 5 files, B: 6 files) approved at the 06-02 blocking human checkpoints with live re-verified Pattern-2 grep proof; all 11 deletions + 5 CS-D in-file retires executed with rationale-bearing commits.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 17min
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Approved — 2026-08-09. D-05 gate green end-to-end (build ✓; Playwright 517 pass / 8 intentional skips / 0 fail / 0 did-not-run across 42 spec files; e2e/api 82 pass; src/bun 2396 pass / 2 skip; typecheck clean; mock-agui 23/23). API-coverage decision recorded (06-COVERAGE.md, `detected:false`). Phase 6 validation contract closed.
