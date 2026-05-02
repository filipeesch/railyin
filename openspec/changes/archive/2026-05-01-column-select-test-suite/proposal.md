## Why

The `fix-column-select-transitions` change introduces a new shared composable (`useColumnTransitions`) and fixes the Task Drawer Select, but ships with no dedicated tests covering these behaviours. This change establishes the full test suite — unit, backend integration verification, and Playwright — ensuring regressions are caught going forward.

## What Changes

- **New** `src/mainview/composables/useColumnTransitions.test.ts` — unit tests for the pure function `getValidTransitionColumns` and the `useColumnTransitions` composable (13 scenarios: GCT-1..9, UCT-1..4)
- **Extended** `e2e/ui/task-toolbar.spec.ts` — 6 new Playwright tests (TT-12..TT-17) covering the workflow Select's `allowedTransitions` enforcement in the Task Drawer
- **Verified** existing `src/bun/test/transition-validator.test.ts` (TV-1..TV-7) fully covers backend enforcement — no new backend tests required
- **Updated** `openspec/changes/fix-column-select-transitions/tasks.md` — adds missing edge-case test tasks (2.4, 5.4) to the original implementation change

## Capabilities

### New Capabilities

- `column-transitions-unit-tests`: Unit test coverage for `getValidTransitionColumns` pure function and `useColumnTransitions` composable, including all edge cases (null input, unknown column ID, out-of-template-order `allowedTransitions`, frozen column)
- `column-select-playwright-tests`: Playwright test coverage for Task Drawer workflow Select behaviour with `allowedTransitions` — option visibility, disabled state, forbidden-column absence, and no-op transition guard

### Modified Capabilities

- `column-allowed-transitions`: Adds Task Drawer Select test scenarios to the existing spec (verifying Select reflects backend constraints end-to-end)

## Impact

- `src/mainview/composables/useColumnTransitions.test.ts` — new file
- `e2e/ui/task-toolbar.spec.ts` — extended with TT-12..TT-17
- `openspec/changes/fix-column-select-transitions/tasks.md` — tasks 2.4 and 5.4 added
- No production code changes
- No new dependencies
