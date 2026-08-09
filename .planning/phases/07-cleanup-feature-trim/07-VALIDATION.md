---
phase: 7
slug: cleanup-feature-trim
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
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
- **Max feedback latency:** ~17 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | Trim items | — | consume() rewrite: zero new writes to old tables | unit + grep | `bun test src/bun --timeout 20000` + grep | ✅ | ⬜ pending |
| TBD | 01 | 1 | — | — | notifyChatSessionUpdated push (sidebar freeze fix) | unit/e2e | targeted | ✅ | ⬜ pending |
| TBD | 02 | 2 | Trim items | — | Dead stack deletion (verified-zero files) | grep + build | `git grep` + `bun run build` | ✅ | ⬜ pending |
| TBD | 02 | 2 | Trim items | — | markClaudeExecution deletion | grep | `git grep markClaudeExecution` → 0 | ✅ | ⬜ pending |
| TBD | 03 | 3 | Trim items | — | Import flag retirement | e2e | `RAILYN_LEGACY_IMPORT=1` spawn test | ✅ | ⬜ pending |
| TBD | 03 | 3 | Trim items | — | Post-deletion full gate (517/0 baseline) | all | `bun run test:e2e` + all suites | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Baseline full-suite run captured (517 pass / 8 skip / 0 fail — Phase 6 gate)
- [ ] Deletion inventory verified via grep (researcher's inventory is the guide)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Failure-toast replacement decision (drop vs new push) | Trim | Product decision | RESEARCH open question — human checkpoint |
| opencode shell-approval posture (auto-approve vs deny) | Trim | Security-relevant | RESEARCH open question — human checkpoint |

*Two decision checkpoints; everything else automated.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 17min
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
