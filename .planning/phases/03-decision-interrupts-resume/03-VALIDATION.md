---
phase: 3
slug: decision-interrupts-resume
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest under `bun test` (backend) + bun:test (e2e/api) |
| **Config file** | `vitest.backend.config.ts`, `vitest.config.ts` |
| **Quick run command** | `bun test src/bun/copilotkit --timeout 20000` |
| **Full suite command** | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` |
| **Estimated runtime** | ~2 minutes |

---

## Sampling Rate

- **After every task commit:** Run the phase's unit tests (`bun test src/bun/copilotkit --timeout 20000`)
- **After every plan wave:** Full suite (above)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~2 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | RUNR-08, VERF-01 | — | Interrupt outcome emission + contract tests | unit | `bun test src/bun/copilotkit --timeout 20000` | ✅ | ⬜ pending |
| TBD | 01 | 1 | CHAT-09 | — | Block-while-pending + resume rules | unit | `bun test src/bun/copilotkit --timeout 20000` | ✅ | ⬜ pending |
| TBD | 02 | 2 | RUNR-08, CHAT-09 | — | Resume translation to orchestrator + orphaned-row finalize | unit/integration | `bun test src/bun --timeout 20000` | ✅ | ⬜ pending |
| TBD | 03 | 3 | RUNR-08, VERF-01 | — | E2E full decision cycle on real wire | integration | `bun test e2e/api/copilotkit --timeout 30000` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Mock-engine decision_request script scenarios (`__SCRIPT_DECISION__`, resume variants)
- [ ] Contract-test fixtures for interrupt outcome + resume arrays

*Existing infrastructure covers the rest (Phase 2 suites).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None — all phase behaviors automated | — | — | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2min
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
