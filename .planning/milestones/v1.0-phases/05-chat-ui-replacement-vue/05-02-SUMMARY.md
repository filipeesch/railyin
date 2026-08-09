---
phase: 05-chat-ui-replacement-vue
plan: 02
subsystem: ui
tags: [vue, copilotkit, ag-ui, tool-call-renderers, decision-interrupt, markdown, mermaid]

# Dependency graph
requires:
  - phase: 03-decision-interrupts-resume
    provides: interrupt/resume payload contract (answers required, INVALID_PAYLOAD, cancelled → rejection)
provides:
  - toolCardDisplay.ts pure helpers (truncateToolOutput, computeDiffStats, toolStatusToIcon, isErrorResult, buildDiffPayloadsFromArgs, CANONICAL_TOOL_SLOTS, slotForToolCall)
  - ShellOutputRenderer / FileChangesRenderer / DelegateSummaryRenderer (components/chat/tool-call-renderers/)
  - DecisionInterrupt.vue (#interrupt slot card with decision-card/decision-submit test ids)
  - buildResumePayload / buildCancelResumePayload in decisionRequest.ts
  - useCommandsCache workspaceKey scope + toToolsMenu mapper
affects: [05-03 RailyinChat tracer, 05-04 chat expansion, 05-05 sidebar]

# Actuals (#2632) — chars/4 over the realized diff (70,133 chars across 10 files)
actuals:
  tokens: 17533
  tasks: 3
  commits: 6

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin presentational .vue components + pure unit-tested .ts helpers (toolCardDisplay.ts / decisionRequest.ts precedent)"
    - "Renderer dispatch on tool name family only (no display.contentType on the AG-UI wire)"
    - "Error state derived from result CONTENT, never slot status (status is 'complete' for errored calls)"
    - "Scope-discriminated cache keys (task:N / ws:key) so card and session command paths coexist"

key-files:
  created:
    - src/mainview/utils/toolCardDisplay.ts
    - src/mainview/components/chat/tool-call-renderers/ShellOutputRenderer.vue
    - src/mainview/components/chat/tool-call-renderers/FileChangesRenderer.vue
    - src/mainview/components/chat/tool-call-renderers/DelegateSummaryRenderer.vue
    - src/mainview/components/chat/DecisionInterrupt.vue
  modified:
    - src/mainview/utils/decisionRequest.ts (buildResumePayload, buildCancelResumePayload)
    - src/mainview/composables/useCommandsCache.ts (workspaceKey scope + toToolsMenu)
    - src/mainview/utils/toolCardDisplay.test.ts (new)
    - src/mainview/utils/decisionRequest.test.ts (extended)
    - src/mainview/composables/useCommandsCache.test.ts (extended)

key-decisions:
  - "Error detection is a pure isErrorResult(result) helper on JSON shapes engines emit (isError, error field, success:false, error-ish status) + raw-text error markers — conservative, unit-tested"
  - "FileDiff/ReadView reuse the legacy components directly (import ../FileDiff.vue / ../ReadView.vue) per PATTERNS.md — D-10 keeps them alive"
  - "Diff payloads for write/edit families are derived from args via buildDiffPayloadsFromArgs (the file_diff feature is removed from the new wire); hunk-less payloads render FileDiff's 'no diff available'"
  - "Delegate child tool calls come from args.children (the wire's ToolMessage is flat) — count badge + name rows, full nested slot rendering deferred to 05-04 wiring"
  - "engine.listCommands handler only reads taskId today (src/bun/handlers/engine.ts:6) — the workspaceKey path returns [] (acceptable v1 per RESEARCH A3, recorded per plan instruction)"
  - "slotForToolCall returns the canonical family key (shell/file/delegate) for renderer selection; RailyinChat's #tool-call-${toolCallName} slot names are a 05-04 concern"

patterns-established:
  - "Pattern 1: Pure display logic lives in .ts utils, tested via vitest's src/mainview/**/*.test.ts include (no Vue plugin)"
  - "Pattern 2: Renderers are thin — they import the pure helpers + legacy composables (useToolResultDisplay, useMarkdown) and legacy display components (FileDiff, ReadView)"
  - "Pattern 3: All new components use --p-* tokens + ported badge hexes with html.dark-mode style blocks, data-testid per UI-SPEC"

requirements-completed: [CHAT-06, UI-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "toolCardDisplay pure helpers — truncateToolOutput (800-char + marker), computeDiffStats, toolStatusToIcon, CANONICAL_TOOL_SLOTS + slotForToolCall"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "src/mainview/utils/toolCardDisplay.test.ts#truncateToolOutput/computeDiffStats/toolStatusToIcon/CANONICAL_TOOL_SLOTS"
        status: pass
    human_judgment: false
  - id: D2
    description: "Error-from-result-only detection (isErrorResult) and arg-derived diff payloads (buildDiffPayloadsFromArgs) — backstop 'failed tool call shows error state' logic"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "src/mainview/utils/toolCardDisplay.test.ts#isErrorResult/buildDiffPayloadsFromArgs"
        status: pass
    human_judgment: false
  - id: D3
    description: "Three domain renderers (ShellOutputRenderer, FileChangesRenderer, DelegateSummaryRenderer) under components/chat/tool-call-renderers/ with status icons, truncation, +N/−N stat chips, ReadView/FileDiff bodies, delegate prompt+result markdown"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "src/mainview/utils/toolCardDisplay.test.ts (helper logic backing the renderers)"
        status: pass
      - kind: other
        ref: "bun run typecheck (component script blocks)"
        status: pass
    human_judgment: true
    rationale: "Rendered card appearance and #tool-call-* slot wiring are only visually verifiable in the 05-04 e2e tool-card spec; helper logic is unit-proven here"
  - id: D4
    description: "buildResumePayload (approved with non-empty answers per INVALID_PAYLOAD contract) + buildCancelResumePayload ({ status: 'cancelled' })"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "src/mainview/utils/decisionRequest.test.ts#buildResumePayload"
        status: pass
    human_judgment: false
  - id: D5
    description: "DecisionInterrupt.vue #interrupt slot card — weight badges, AI-suggests lean, option rows, Other+notes, record toggle, Submit Decision CTA (decision-card/decision-submit), mermaid context, answered collapsed summary"
    requirement: CHAT-06
    verification:
      - kind: other
        ref: "bun run typecheck (component script block)"
        status: pass
    human_judgment: true
    rationale: "Decision-card UX (mermaid context rendering, form interaction) requires visual UAT; e2e decision scenario lands in 05-04"
  - id: D6
    description: "useCommandsCache workspaceKey scope (getCommandsForWorkspace/Ref/Clear) + exported toToolsMenu (ToolsMenuItem[] with '/' prefix, zero-commands → [])"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "src/mainview/composables/useCommandsCache.test.ts#workspaceKey scope/toToolsMenu"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-08-09
status: complete
---

# Phase 5 Plan 2: Chat Building Blocks (tool-call renderers, decision card, commands mapper) Summary

**Ported the three domain tool-call renderers (shell output, file changes, delegate summaries), the DecisionInterrupt #interrupt-slot card with resume payload mapper, and the workspaceKey-scoped commands cache + toToolsMenu helper — all backed by pure, unit-tested .ts logic under src/mainview/components/chat/ and src/mainview/utils/, with legacy files untouched (D-10).**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-09T10:15:27Z
- **Completed:** 2026-08-09T10:23:47Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- `toolCardDisplay.ts` with 7 pure helpers: truncateToolOutput (800-char + "…[truncated]" marker), computeDiffStats, toolStatusToIcon (spinner/check/times-circle with #dc2626 error), isErrorResult (error from result content only — the wire's status is "complete" for errored calls), buildDiffPayloadsFromArgs (write/edit families), CANONICAL_TOOL_SLOTS mirroring tool-display.ts:19-49, slotForToolCall (shell/file/delegate families, null for MCP tools → default card)
- Three thin renderers consuming the helpers + legacy composables (useToolResultDisplay, useMarkdown) and legacy display components (FileDiff.vue, ReadView.vue imported directly per D-10): ShellOutputRenderer (pre-formatted truncated output, pending spinner + "Running…"), FileChangesRenderer (name-family dispatch → ReadView body / FileDiff body with +N/−N chips), DelegateSummaryRenderer (intent header, collapsible Prompt, result markdown, child count badge)
- DecisionInterrupt.vue (#interrupt slot renderer, ported DecisionRequest form: weight badges amber/blue/green, "AI suggests" lean, Other + notes, record toggle, Submit Decision CTA, mermaid context, answered collapsed summary for D-08 replay; data-testid decision-card/decision-submit)
- buildResumePayload / buildCancelResumePayload in decisionRequest.ts matching the event-bridge.ts:380-422 resume contract (resolved resume must carry answers — INVALID_PAYLOAD otherwise; cancelled → rejection)
- useCommandsCache generalized to scope-discriminated keys (task:N / ws:key) with taskId API unchanged for existing consumers, plus workspaceKey fetch/ref/clear functions and the exported pure toToolsMenu mapper (ToolsMenuItem[] with "/" prefix, zero-commands → [] hides the menu affordance)
- 46 unit tests across the three pure-helper suites (27 + 5 + 7 new; all existing tests still green)

## Task Commits

Each task was committed atomically (TDD: test → feat per task):

1. **Task 1: Domain tool-call renderers + pure display helpers** - `d958e5b9` (test: failing tests for tool card display helpers) → `ea4402bd` (feat: domain tool-call renderers + pure display helpers)
2. **Task 2: DecisionInterrupt.vue port + resume payload mapper** - `22d55b03` (test: failing tests for resume payload mapper) → `a5cb1efd` (feat: decision interrupt card + resume payload mapper)
3. **Task 3: useCommandsCache workspaceKey scope + toToolsMenu** - `9cd59add` (test: failing tests for workspaceKey commands scope + toToolsMenu) → `990e7342` (feat: workspaceKey-scoped commands cache + toToolsMenu mapper)

**Plan metadata:** pending (05-02-SUMMARY.md commit)

## Files Created/Modified

- `src/mainview/utils/toolCardDisplay.ts` - Pure display helpers (truncation, diff stats, status icons, error detection, arg-derived payloads, canonical tool slots)
- `src/mainview/utils/toolCardDisplay.test.ts` - 27 unit tests (TCD-1..27)
- `src/mainview/components/chat/tool-call-renderers/ShellOutputRenderer.vue` - bash/run/run_in_terminal output card
- `src/mainview/components/chat/tool-call-renderers/FileChangesRenderer.vue` - read/write/edit/apply_patch card (ReadView/FileDiff bodies)
- `src/mainview/components/chat/tool-call-renderers/DelegateSummaryRenderer.vue` - subagent summary card
- `src/mainview/components/chat/DecisionInterrupt.vue` - #interrupt slot decision card (669 lines, ported form + answered state)
- `src/mainview/utils/decisionRequest.ts` - added buildResumePayload + buildCancelResumePayload
- `src/mainview/utils/decisionRequest.test.ts` - 5 new tests (DRU-14..18)
- `src/mainview/composables/useCommandsCache.ts` - scope keys + workspaceKey API + toToolsMenu
- `src/mainview/composables/useCommandsCache.test.ts` - 7 new tests (CMD-1..7)

## Decisions Made

- Error detection as a pure `isErrorResult` helper (JSON shapes engines emit + raw-text markers) rather than inline heuristics in the renderers — conservative and unit-tested, satisfying the backstop "failed tool call shows error state"
- FileDiff.vue / ReadView.vue imported directly from the legacy components (still alive per D-10) instead of re-porting their windowing logic — PATTERNS.md-prescribed, keeps the diff/read bodies byte-identical
- `buildDiffPayloadsFromArgs` derives FileDiffPayload[] from tool args (the removed file_diff feature means no payload source on the new wire); hunk-less payloads render FileDiff's "no diff available"
- Delegate children sourced from `args.children` since the AG-UI ToolMessage is flat; count badge + name rows now, full nested slot rendering is 05-04 wiring
- `slotForToolCall` returns the canonical family key (shell/file/delegate); exact `tool-call-${toolCallName}` slot declarations land in RailyinChat (05-04)
- Confirmed per plan instruction: `src/bun/handlers/engine.ts:6` only reads `params.taskId`, so the workspaceKey path returns `[]` — acceptable v1 (RESEARCH A3), no backend change in this plan

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added isErrorResult + buildDiffPayloadsFromArgs pure helpers beyond the five planned exports**
- **Found during:** Task 1 (renderer implementation)
- **Issue:** The acceptance criteria require error state from result content only, and FileChangesRenderer needs diff payloads to feed the ported FileDiff structure — the plan's export list named no home for either piece of logic, and inline heuristics would violate the pure-helper precedent
- **Fix:** Added `isErrorResult(result)` (JSON shapes engines emit + conservative raw-text markers) and `buildDiffPayloadsFromArgs(args)` (diff-shaped pass-through, content → write payload, old/new strings → edit payload) to toolCardDisplay.ts with 10 dedicated unit tests
- **Files modified:** src/mainview/utils/toolCardDisplay.ts, src/mainview/utils/toolCardDisplay.test.ts
- **Verification:** 27/27 toolCardDisplay tests pass; typecheck clean
- **Committed in:** ea4402bd (Task 1)

**2. [Rule 2 - Missing Critical] Delegate children fallback via args.children**
- **Found during:** Task 1 (DelegateSummaryRenderer)
- **Issue:** The plan's must_have says nested child tool calls collapse inside with a count badge; the verified AG-UI `ToolMessage` type is flat (id/content/role/toolCallId only) — no children on the wire
- **Fix:** Extract `args.children` defensively when an engine includes nested calls in subagent args; render the count badge + name rows; full nested slot rendering deferred to 05-04 wiring
- **Files modified:** src/mainview/components/chat/tool-call-renderers/DelegateSummaryRenderer.vue
- **Verification:** typecheck clean; component renders badge only when children exist
- **Committed in:** ea4402bd (Task 1)

---

**Total deviations:** 2 auto-fixed (2 Rule 2 — missing critical)
**Impact on plan:** Both additions are correctness requirements from the acceptance criteria/backstop, not scope creep. No plan-listed behavior was skipped.

## Issues Encountered

- **Stash contamination incident (not a code issue):** While verifying that the 85 full-directory test failures were pre-existing, a `git stash push`/`git stash pop` cycle popped a PRE-EXISTING sibling-worktree stash ("WIP on develop: ed3ec10") into this worktree (the stash list is shared across worktrees), leaving `src/bun/engine/copilot/engine.ts` in a conflicted (UU) state. Resolved by restoring that single file to HEAD via `git restore --source=HEAD --staged --worktree` — the sibling stash entry itself was preserved intact for its owner, and no files belonging to this plan were affected. Verified clean working tree afterwards. Lesson: never use `git stash` in worktree mode.
- **Pre-existing full-directory test failures:** `bun test src/mainview` reports 85 failures in Pinia store suites — reproduced byte-identical at the pre-plan commit `b0087c7a` (documented in deferred-items.md by 05-01; store files pass in isolation). This plan's wave-gate evidence uses per-file suites + typecheck, matching 05-01's convention. Pass count grew 113 → 152 (39 new tests) with zero new failures.
- **workspaceKey handler gap:** `engine.listCommands` ignores `workspaceKey` today (handler reads only `params.taskId`) → session-scope fetches return `[]`. Acceptable v1 per RESEARCH A3; the cache layer is scope-correct regardless, so wiring it to a workspace-aware handler later is a backend-only change.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All five building blocks (3 renderers + decision card + commands mapper) are committed under `components/chat/` with unit-tested pure logic — ready for `RailyinChat.vue` (05-03 tracer) and the full chat expansion (05-04), which wires `#tool-call-*` slots, the `#interrupt` slot resolve/cancel, and the toolsMenu via `toToolsMenu`
- `DecisionInterrupt` emits the exact buildResumePayload shape the `resolve()` contract needs (answers always present → no INVALID_PAYLOAD)
- Known v1 gap: workspaceKey commands return `[]` until the backend handler is extended (recorded above)

---

*Phase: 05-chat-ui-replacement-vue*
*Completed: 2026-08-09*

## Self-Check: PASSED

- All 6 key files exist on disk (verified via `[ -f ]`)
- All 6 task commits present in git log: d958e5b9, ea4402bd, 22d55b03, a5cb1efd, 9cd59add, 990e7342
- Wave gate: `bun test src/mainview/utils/toolCardDisplay.test.ts` + `decisionRequest.test.ts` + `useCommandsCache.test.ts` all green (46 tests); `bun run typecheck` clean; full-dir suite at documented pre-existing baseline (152 pass / 85 pre-existing fail)
