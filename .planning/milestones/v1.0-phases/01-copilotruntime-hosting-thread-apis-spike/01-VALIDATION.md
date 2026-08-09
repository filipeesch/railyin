---
phase: 1
slug: copilotruntime-hosting-thread-apis-spike
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-08
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest under `bun test` (backend) + Playwright (E2E fixtures, later phases) |
| **Config file** | `vitest.backend.config.ts`, `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `bun test e2e/api --timeout 30000` |
| **Full suite command** | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test e2e/api --timeout 30000`
- **After every plan wave:** Run `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD (filled at plan time) | 01 | 1 | HOST-01 | — | Runtime mount restricted to `/api/copilotkit/*` prefix | integration | `bun test e2e/api/copilotkit` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | HOST-02 | — | SSE streams survive silences; `server.timeout(req,0)` applied | integration | `bun test e2e/api/copilotkit` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | HOST-03 | — | Pins asserted in package.json; handler decision recorded in PROJECT.md | source | `bun run typecheck` + grep assertions | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `e2e/api/copilotkit/probe.test.ts` — runtime probe suite (info/run/connect/stop/400/silence)
- [ ] `e2e/ui/fixtures/mock-agui.ts` (or `mock-runtime/`) — AG-UI fixture module validated against real server
- [ ] Dependency install — `@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57`, `@ag-ui/encoder@0.0.57`, `@copilotkit/runtime@1.66.4` (vue deferred to Phase 5)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `bun run dev` serves `/api/copilotkit/*` from the same origin (no second process) | HOST-01 | Dev-server smoke is a human boot check | Start `bun run dev --port=3001`, verify no extra listener, hit `/api/copilotkit/info` in browser |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
