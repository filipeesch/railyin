---
phase: 2
slug: ag-ui-bridge-railyinagentrunner
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest under `bun test` (backend) + bun:test (e2e/api) |
| **Config file** | `vitest.backend.config.ts`, `vitest.config.ts` |
| **Quick run command** | `bun test src/bun/test/copilotkit --timeout 20000` (or per-file) |
| **Full suite command** | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` |
| **Estimated runtime** | ~2 minutes |

---

## Sampling Rate

- **After every task commit:** Run the phase's unit tests (`bun test src/bun/test/copilotkit --timeout 20000`)
- **After every plan wave:** Full suite (above)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~2 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | RUNR-01, BRDG-01 | — | Bridge translation unit tests | unit | `bun test src/bun/test/copilotkit/event-bridge.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | RUNR-02, RUNR-05 | — | JSONL store append + replay | unit | `bun test src/bun/test/copilotkit/jsonl-store.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | RUNR-03, RUNR-04, RUNR-06 | — | Runner lifecycle (lock, empty connect) | unit | `bun test src/bun/test/copilotkit/railyin-runner.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | RUNR-01, RUNR-07 | — | Agent clone() + tool-result synthesis | unit | `bun test src/bun/test/copilotkit/railyin-agent.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 03 | 3 | BRDG-01..03 | — | E2E round-trip via probe extension | integration | `bun test e2e/api/copilotkit --timeout 30000` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/bun/test/copilotkit/event-bridge.test.ts` — EngineEvent → BaseEvent translation stubs
- [ ] `src/bun/test/copilotkit/jsonl-store.test.ts` — store append/read stubs
- [ ] `src/bun/test/copilotkit/railyin-runner.test.ts` — runner lifecycle stubs
- [ ] `src/bun/test/copilotkit/railyin-agent.test.ts` — agent contract stubs
- [ ] Mock engine extension (scripted tool calls, reasoning) in `src/bun/testing/mock-engine.ts`

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
