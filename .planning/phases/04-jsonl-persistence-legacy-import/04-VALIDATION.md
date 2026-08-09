---
phase: 4
slug: jsonl-persistence-legacy-import
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
---

# Phase 4 — Validation Strategy

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
| TBD | 01 | 1 | CHAT-08 | — | threads.list scans JSONL dir + metadata | unit | `bun test src/bun/copilotkit --timeout 20000` | ✅ | ⬜ pending |
| TBD | 01 | 1 | — | — | Store crash tolerance (partial-line, atomic write) | unit | `bun test src/bun/copilotkit --timeout 20000` | ✅ | ⬜ pending |
| TBD | 02 | 2 | IMPR-01, IMPR-02 | — | Legacy import conversion + idempotency | unit/integration | `bun test src/bun --timeout 20000` | ✅ | ⬜ pending |
| TBD | 03 | 3 | CHAT-08, IMPR-01 | — | E2E: threads.list + import on real server | integration | `bun test e2e/api --timeout 30000` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Thread-list + import test fixtures (seeded legacy tables)
- [ ] Store crash-tolerance test scenarios (partial trailing line, atomic write)

*Existing infrastructure covers the rest.*

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
