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
> Draft paths corrected to the actual artifact locations (src/bun/copilotkit/ co-located suites + src/bun/test/execution-seam.test.ts); 02-03 Task 3 completes this file (verification map ticked, `wave_0_complete: true`, `nyquist_compliant: true`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest under `bun test` (backend) + bun:test (e2e/api) |
| **Config file** | `vitest.backend.config.ts`, `vitest.config.ts` |
| **Quick run command** | `bun test src/bun/copilotkit --timeout 20000` + `bun test src/bun/test/execution-seam.test.ts --timeout 20000` (per-file commands in the map below) |
| **Full suite command** | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` |
| **Estimated runtime** | ~2 minutes |

---

## Sampling Rate

- **After every task commit:** Run the phase's unit tests (`bun test src/bun/copilotkit --timeout 20000` — includes the seam file via the explicit quick-run above)
- **After every plan wave:** Full suite (above)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~2 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01 T1 | 01 | 1 | BRDG-01 | T-02-01..06 | Seam contract through the REAL executor chain: onEngineEvent per raw event in order, onRunEnd at 4 terminal outcomes, byte-identical when opts absent | unit (real chain) | `bun test src/bun/test/execution-seam.test.ts` | ❌ W0 | ⬜ pending |
| 02-01 T2 | 01 | 1 | BRDG-01/02/03 | T-02-03/05/06 | Bridge translation: every EngineEvent family → EventSchemas-valid AG-UI events; exactly one terminal; D-09 synthesis; toolCallId namespacing | unit | `bun test src/bun/copilotkit/event-bridge.test.ts` | ❌ W0 | ⬜ pending |
| 02-01 T3 | 01 | 1 | RUNR-01/03, BRDG-01/02/03 | T-02-01/04 | Agent lifecycle: RUN_STARTED-first with input, clone() preserves deps, abortRun() → cancel, terminal completion guard, unknown-conversation RUN_ERROR | unit (fake coordinator) | `bun test src/bun/copilotkit/railyin-agent.test.ts` | ❌ W0 | ⬜ pending |
| 02-01 T3 | 01 | 1 | RUNR-01/03, BRDG-02/03 | T-02-02 | Real wire: run through RailyinAgent + scripted mock engine — RUN_STARTED..RUN_FINISHED, tool/reasoning lifecycle, dangling-tool synthesis, RUN_ERROR terminal | e2e/api | `bun test e2e/api/copilotkit/railyin.test.ts && bun test e2e/api/copilotkit/copilotkit.test.ts` | ❌ W0 | ⬜ pending |
| 02-02 T1 | 02 | 2 | RUNR-02/05/06 | T-02-07/09 | JSONL store: append/read/exists, missing-file → null, traversal + absolute-path rejection, tolerant read, dir creation | unit | `bun test src/bun/copilotkit/jsonl-store.test.ts` | ❌ W0 | ⬜ pending |
| 02-02 T2 | 02 | 2 | RUNR-04/05/07 | T-02-08/11 | Runner: lock throw, wire-exact persistence (incl. patched RUN_STARTED.input), 5 replay shapes, dangling-tool synthesis, hot path | unit | `bun test src/bun/copilotkit/railyin-runner.test.ts` | ❌ W0 | ⬜ pending |
| 02-02 T3 | 02 | 2 | RUNR-02/03/04/05/06/07 | T-02-08 | Wire: JSONL on disk, never-run connect (200 + zero frames), concurrent run (200 + empty body), restart replay with completed tool calls | e2e/api | `bun test e2e/api/copilotkit/railyin.test.ts && bun test e2e/api/copilotkit/copilotkit.test.ts` | ❌ W0 | ⬜ pending |
| 02-03 T1 | 03 | 2 | RUNR-03/04 | T-02-12/15 | Resolver 3 branches (task → chat_sessions → default), advisory cross-path lock (THREAD_BUSY), unknown conversation (THREAD_NOT_FOUND) | unit (real DB) | `bun test src/bun/copilotkit/railyin-agent.test.ts && bun test e2e/api/copilotkit/railyin.test.ts` | ❌ W0 | ⬜ pending |
| 02-03 T2 | 03 | 2 | HOST-03 (rxjs pin) | T-02-SC | rxjs ^7.8.2 explicit direct dependency asserted by the pins test | e2e/api | `bun test e2e/api/copilotkit/pins.test.ts && bun run typecheck` | ✅ | ⬜ pending |
| 02-03 T3 | 03 | 2 | phase gate | — | Full backend + e2e suites + typecheck green in one pass | full suite | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — commands carry no `-x` flag (invalid on bun 1.4.0).*

---

## Wave 0 Requirements

- [ ] `src/bun/copilotkit/event-bridge.test.ts` — EngineEvent → BaseEvent translation stubs (BRDG-01..03)
- [ ] `src/bun/copilotkit/jsonl-store.test.ts` — store append/read stubs (RUNR-02, security V5/V8)
- [ ] `src/bun/copilotkit/railyin-runner.test.ts` — runner lifecycle stubs (RUNR-04..07)
- [ ] `src/bun/copilotkit/railyin-agent.test.ts` — agent contract stubs (RUNR-01/03)
- [ ] `src/bun/test/execution-seam.test.ts` — real-chain seam contract stubs (BRDG-01; created by 02-01 T1)
- [ ] e2e real-server suite `e2e/api/copilotkit/railyin.test.ts` — wire-level proof on the mock engine
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
- [ ] Open-question resolutions recorded (Q1 → 02-02 T2, Q2/Q3 → 02-03 T1)

**Approval:** pending
