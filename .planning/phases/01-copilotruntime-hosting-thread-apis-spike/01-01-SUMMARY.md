---
phase: 1-copilotruntime-hosting-thread-apis-spike
plan: 1
subsystem: api
tags: [copilotkit, ag-ui, bun, pinning, host-03]

# Dependency graph
requires: []
provides:
  - Five exact pins in package.json dependencies: @copilotkit/runtime@1.66.4, @copilotkit/vue@1.66.4, @ag-ui/core@0.0.57, @ag-ui/client@0.0.57, @ag-ui/encoder@0.0.57
  - bun.lock resolved tree: zod@3.25.76 nested under copilotkit/ag-ui packages, rxjs@7.8.1 under runtime/client, @ag-ui/* exact 0.0.57
  - e2e/api/copilotkit/pins.test.ts — unit test locking the pins (HOST-03 evidence, bump-drift guard)
  - Green build + typecheck proving assumption A1 (install does not break the app)
affects: [01-02-runtime-mount, 01-03-fixture-validation, phase 5 vue-sdk-consumption]

actuals:
  tokens: 46661
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: [@copilotkit/runtime@1.66.4, @copilotkit/vue@1.66.4, @ag-ui/core@0.0.57, @ag-ui/client@0.0.57, @ag-ui/encoder@0.0.57]
  patterns:
    - "Exact-pin convention: `bun add --exact pkg@x.y.z` (never hand-edit package.json), matching the existing @anthropic-ai/claude-agent-sdk exact pin"
    - "Pin-evidence test pattern: pure unit test reading repo-root package.json via node:fs, asserting exact strings — a future casual bump fails loudly"

key-files:
  created: [e2e/api/copilotkit/pins.test.ts]
  modified: [package.json, bun.lock]

key-decisions:
  - "All five CopilotKit/AG-UI packages go in `dependencies` as exact pins (D-09/D-10) — @copilotkit/vue is a regular dep despite being unconsumed this phase"
  - "zod@3 nesting confirmed as install-time finding (Pitfall 5): zod@3.25.76 nests under @copilotkit/runtime, @copilotkit/vue, @ag-ui/core, @ag-ui/client — project zod@4.3.6 untouched"
  - "Package legitimacy gate (Task 1) approved by human: both [SUS]-flagged 1.66.4 packages confirmed on npmjs.com before install"

patterns-established:
  - "Pattern 1: exact-pin + pin-evidence test — pins land via bun add --exact; a unit test asserts the exact strings so drift fails CI"

requirements-completed: [HOST-03]

coverage:
  - id: D1
    description: "Five exact CopilotKit/AG-UI pins in package.json dependencies with no carets"
    requirement: HOST-03
    verification:
      - kind: unit
        ref: "e2e/api/copilotkit/pins.test.ts#all five packages are pinned with exact versions in dependencies"
        status: pass
      - kind: unit
        ref: "e2e/api/copilotkit/pins.test.ts#@copilotkit/vue is a regular dependency, not a devDependency (D-10)"
        status: pass
      - kind: unit
        ref: "e2e/api/copilotkit/pins.test.ts#@ag-ui/* pins are exact — no caret ranges in dependencies"
        status: pass
      - kind: other
        ref: "bun pm ls — @ag-ui/core/client/encoder@0.0.57, @copilotkit/runtime@1.66.4, @copilotkit/vue@1.66.4"
        status: pass
    human_judgment: false
  - id: D2
    description: "Install is build-clean — bun run build and bun run typecheck both exit 0 (assumption A1)"
    requirement: HOST-03
    verification:
      - kind: other
        ref: "bun run build — exit 0 (✓ built in 15.41s)"
        status: pass
      - kind: other
        ref: "bun run typecheck — tsc --noEmit exit 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Human approval of the two [SUS]-flagged CopilotKit 1.66.4 packages before install (package legitimacy gate)"
    requirement: HOST-03
    verification:
      - kind: manual_procedural
        ref: "checkpoint:human-verify (blocking-human) — user verified official CopilotKit org, 1.66.4 existence, publish date 2026-08-07, no postinstall scripts on npmjs.com; approved"
        status: pass
    human_judgment: true
    rationale: "Trust-establishing step by design (T-1-SC mitigation): a human must confirm package legitimacy on npmjs.com; the gate is never auto-approvable"

# Metrics
duration: 6min
completed: 2026-08-08
status: complete
---

# Phase 1 Plan 1: Exact CopilotKit/AG-UI Stack Pins Summary

**Five exact pins (@copilotkit/runtime + @copilotkit/vue @1.66.4, @ag-ui/* @0.0.57) installed via `bun add --exact` with green build/typecheck, zod@3 nesting confirmed, and a pin-locking unit test (HOST-03 evidence)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-08T21:37:00Z
- **Completed:** 2026-08-08T21:43:01Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Human approved the two [SUS]-flagged packages (@copilotkit/runtime@1.66.4, @copilotkit/vue@1.66.4 — published 2026-08-07, official CopilotKit org, no postinstall scripts) at the blocking-human checkpoint; install proceeded
- `bun add --exact` recorded all five pins in `dependencies` with exact versions, no carets (D-09/D-10; @copilotkit/vue pinned-but-unconsumed)
- Install-time findings recorded: **zod@3.25.76 nests** under @copilotkit/runtime, @copilotkit/vue, @ag-ui/core, @ag-ui/client (Pitfall 5 clean — project zod@4.3.6 untouched); **rxjs@7.8.1** nested under runtime/client (top-level rxjs@7.8.2 from another dep); @ag-ui/* resolve exactly to 0.0.57; **no peer/dep conflicts** from bun install
- `bun run build` (exit 0, 15.41s) and `bun run typecheck` (exit 0) both green — assumption A1 holds
- Zero imports of @copilotkit/vue or @ag-ui/* anywhere in src/ or e2e/ — pin-only this phase (D-10)
- `e2e/api/copilotkit/pins.test.ts` passes (3 tests, 9 expect calls) — HOST-03 pin evidence + drift guard

## Task Commits

Each task was committed atomically:

1. **Task 1: Human-verify the two SUS-flagged CopilotKit packages before install** - checkpoint:human-verify (blocking-human), approved by user 2026-08-08 — no commit (verification gate, nothing built)
2. **Task 2: Install the five pinned packages exactly and gate the build** - `2819865e` (chore)
3. **Task 3: Lock the pins with a unit test** - `9b796bf0` (test)

**Plan metadata:** committed with SUMMARY (docs commit follows)

## Files Created/Modified

- `package.json` - Five exact pins added to `dependencies`: @copilotkit/runtime "1.66.4", @copilotkit/vue "1.66.4", @ag-ui/core "0.0.57", @ag-ui/client "0.0.57", @ag-ui/encoder "0.0.57" (no carets)
- `bun.lock` - Resolved tree: zod@3.25.76 nested under copilotkit/ag-ui, rxjs@7.8.1 under runtime/client, @ag-ui/* exact 0.0.57
- `e2e/api/copilotkit/pins.test.ts` - Unit test asserting the five exact pin strings, @copilotkit/vue absent from devDependencies (D-10), and exact AG-UI versions

## Decisions Made

- All five packages pinned as exact `dependencies` via `bun add --exact` — never hand-edit package.json (lockfile drift prevention, T-1-02 mitigation)
- @copilotkit/vue is a regular dependency per D-10 (Phase 5 consumes it) despite zero imports this phase
- zod@3 nesting treated as an install-time finding per RESEARCH Pitfall 5 — verified bun nested it correctly under copilotkit, no project zod@4 import enters AG-UI code paths

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pins.test.ts package.json path resolved one level short**
- **Found during:** Task 3 (Lock the pins with a unit test)
- **Issue:** Plan's snippet `new URL("../../package.json", import.meta.url)` resolved to `e2e/package.json` (ENOENT) — `import.meta.url` anchors to the test file at `e2e/api/copilotkit/`, needing three `../` levels to reach the repo root, not two
- **Fix:** Changed to `new URL("../../../package.json", import.meta.url)`
- **Files modified:** e2e/api/copilotkit/pins.test.ts
- **Verification:** `bun test e2e/api/copilotkit/pins.test.ts` passes (3 pass, 0 fail, exit 0)
- **Committed in:** 9b796bf0 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix corrected the plan's path math to match the actual file location; no scope creep.

## Issues Encountered

- None beyond the path deviation above (bun install emitted no copilotkit-related warnings; code-server postinstall noise is pre-existing project behavior, unrelated to this change)

## Authentication Gates

- None. Package installs require no credentials.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for **plan 01-02 (runtime mount)**: exact pins installed and build-clean; runtime@1.66.4 with nested zod@3.25.76 + rxjs@7.8.1 verified present; @ag-ui/client@0.0.57 available for the probe. The zod@3 nesting finding means 01-02's probe must import AG-UI schemas from the pinned packages, never from project zod@4 (Pitfall 5 remains live through 01-03)
- `bun pm ls` evidence recorded above — `bun pm ls` is repeatable any time (`bun pm ls --all | grep -E 'zod@3|rxjs'`)

---
*Phase: 1-copilotruntime-hosting-thread-apis-spike*
*Completed: 2026-08-08*

## Self-Check: PASSED
