---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 2
current_phase_name: AG-UI Bridge & RailyinAgentRunner
status: executing
stopped_at: Phase 1 context gathered
last_updated: "2026-08-09T04:24:50.941Z"
last_activity: 2026-08-09
last_activity_desc: Phase 2 execution started
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 6
  completed_plans: 3
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-08)

**Core value:** The board + task card workflow with decision-request UX, powered by pluggable engine adapters, must keep working end-to-end while the chat stack underneath is swapped for AG-UI + CopilotKit.
**Current focus:** Phase 2 — AG-UI Bridge & RailyinAgentRunner

## Current Position

Phase: 2 (AG-UI Bridge & RailyinAgentRunner) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 2
Last activity: 2026-08-09 — Phase 2 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| — | — | — | — |
| 1 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 7-phase migration in dependency order — spike → bridge/runner → interrupts → persistence/import → UI swap → E2E → cleanup (rollback-safe: old code survives until the swap passes E2E)
- [Phase 1]: Resolve fetch-native vs hono handler contradiction (STACK.md recommends fetch-native `createCopilotRuntimeHandler`; PROJECT.md assumed hono) — decide with evidence during Phase 1
- [Phase 1]: Pin exact versions (`@ag-ui/core`/`@ag-ui/client@0.0.57`, `@copilotkit/runtime`/`@copilotkit/vue@1.66.4`) — Vue SDK is early-access and version-sensitive; do not bump AG-UI independently

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: `useThreads` is unavailable on self-hosted runtimes — own thread-index endpoint (CHAT-08, Phase 4) is the reliable path
- [Phase 1]: Bun `idleTimeout: 30` silently kills long SSE streams during engine silences — mitigate in Phase 1
- [Phase 2]: Multi-run replay may throw `verifyEvents` errors on the pinned `@ag-ui/client` (issue #4943) — verify against installed packages, not docs
- [Phase 5]: CopilotKit Vue is early-access; regenerate API unconfirmed, React docs only directional — budget a parity-surprise buffer
- [Phase 5]: Engine abort semantics differ per engine SDK — spike `stop()` for all five adapters before wiring the UI stop button
- [Phase 6]: 55 Playwright specs hand-mock the old custom protocol — fixture layer must be rebuilt (mock-runtime/mock-agui against `/api/copilotkit/*`), not adapted

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-08-08T20:36:40.044Z
Stopped at: Phase 1 context gathered
Resume file: .planning/phases/01-copilotruntime-hosting-thread-apis-spike/01-CONTEXT.md
