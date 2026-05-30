## Context

`worktree-management.spec.ts` is a 32-test Playwright suite that validates all worktree UI behaviour: display states (W-A), delete flow (W-B), create new branch (W-C), create existing branch (W-D), error/retry (W-E), guard rails during running execution (W-F), and task overlay save behaviour (W-G).

All tests use a shared `openInfoTab()` helper that clicks `.tab-btn:has-text("Info")` and awaits `.task-tab-info`. Every scoped assertion uses `.task-tab-info` as the root selector. After `create-git-tab` is implemented, the worktree section lives under `.task-tab-git` inside the Git tab — all existing assertions will target the wrong element.

`task-drawer.spec.ts` covers tab switching (Chat, Info, Decisions) but has no Git tab test.

## Goals / Non-Goals

**Goals:**
- Re-target all 32 existing worktree tests to the Git tab without changing what each test validates
- Add W-H suite (6 tests) covering Git tab navigation, tab order, and Info-tab regression guards
- Add TD-8 to `task-drawer.spec.ts` for Git tab navigation
- Keep tests as close to existing patterns as possible (same fixture API, same selector conventions)

**Non-Goals:**
- Adding tests for backend git handlers (unchanged)
- Adding Vitest unit tests for `TaskGitPanel`/`TaskGitTab` (behaviour fully covered by Playwright)
- Testing git log, diff, or status views (not in scope for `create-git-tab`)

## Decisions

### Re-target by renaming the helper, not duplicating tests
Replace `openInfoTab()` with `openGitTab()` and update all 32 call sites. This is a mechanical rename — zero test logic changes. Each test still validates the exact same worktree behaviour; only the navigation path changes.

**Alternative considered**: Add a second `openGitTab` helper and run both sets in parallel suites to validate the old Info path also no longer has worktree content. Rejected — over-engineered. A single W-H regression test (Info tab must not show Worktree section) is sufficient.

### CSS class convention: `.task-tab-git`
`TaskGitPanel.vue` must place `class="task-tab-git"` on its root element (matching the `.task-tab-info` pattern in `TaskInfoPanel.vue`). This is not a test-only concern — it's part of the implementation contract established by `create-git-tab`. Tests rely on it for scoped assertions.

### W-H suite lives in `worktree-management.spec.ts`
Navigation tests are co-located with the tests they guard against. W-H validates the move happened correctly — it belongs in the same file, not a separate spec.

## Risks / Trade-offs

[Selector fragility if CSS class changes] → The `.task-tab-git` class is part of the implementation spec (`create-git-tab` design.md). If implementation deviates, tests fail loudly — which is the desired behavior.

[Test count grows from 32 to 39 in one file] → Acceptable. The file is already large; the W-H addition is 6 focused tests that justify their presence alongside the existing suites.

[State isolation across tab switches] → A W-H test covers delete-confirmation reset on tab switch. This guards a subtle Vue reactivity edge case (the `confirmingDelete` ref resetting when `TaskGitPanel` unmounts).
