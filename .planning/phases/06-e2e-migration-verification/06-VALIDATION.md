---
phase: 6
slug: e2e-migration-verification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
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
| TBD | 01 | 1 | VERF-02 | — | Retire removed-feature specs (code-verified) | grep + Playwright | `bunx playwright test <retired>` absent | ✅ | ⬜ pending |
| TBD | 02 | 2 | VERF-02 | — | Migrate chat-surface specs onto mock foundation | Playwright | `bunx playwright test <migrated>` | ✅ | ⬜ pending |
| TBD | 02 | 2 | VERF-02 | — | MockAgui multi-message replay knob + tests | unit | `bun test e2e/ui/fixtures --timeout 20000` | ✅ | ⬜ pending |
| TBD | 03 | 3 | VERF-02, VERF-03 | — | Full-suite green gate | Playwright + backend | `bun run test:e2e` + `bun test e2e/api` + `bun test src/bun` + `bun run typecheck` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Baseline: full-suite run captured (408 pass / 301 fail / 4 not-run) — RESEARCH.md §Baseline
- [ ] MockAgui multi-message replay knob + mock-agui.test.ts cases

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Retire-list confirmation (11 whole files) | VERF-02 | Destructive (file deletion) — human checkpoint per RESEARCH Q1 | Confirm each retired spec tests a feature removed in Phase 5 (code-verified rationale in plan) |

*One retire checkpoint per file (blocking-human); everything else automated.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 17min
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
