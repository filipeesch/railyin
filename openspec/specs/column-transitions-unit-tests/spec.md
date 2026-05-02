## Purpose
Defines the unit test coverage for the `getValidTransitionColumns` pure function and the `useColumnTransitions` composable reactive behaviour.

## Requirements

### Requirement: Pure function getValidTransitionColumns is fully tested for all input combinations
The pure function `getValidTransitionColumns` SHALL have unit tests covering every filtering rule and edge case. Tests inject data directly — no Vue mocking, no API calls.

#### Scenario: GCT-1 — no allowedTransitions returns all columns with current disabled
- **WHEN** `getValidTransitionColumns` is called with a template of 5 columns and `fromColumnId` pointing to a column with no `allowedTransitions` configured
- **THEN** all 5 columns are returned; the current column has `disabled: true`; all others have `disabled: false`

#### Scenario: GCT-2 — empty allowedTransitions returns only current column disabled
- **WHEN** `getValidTransitionColumns` is called for a column with `allowedTransitions: []`
- **THEN** only the current column is returned with `disabled: true`; no other columns are included

#### Scenario: GCT-3 — partial allowedTransitions returns current plus allowed targets only
- **WHEN** `getValidTransitionColumns` is called for a column with `allowedTransitions: ["plan", "done"]` in a 5-column template
- **THEN** exactly 3 items are returned: the current column (`disabled: true`), `plan` (`disabled: false`), `done` (`disabled: false`); remaining 2 columns are absent

#### Scenario: GCT-4 — undefined template returns empty array
- **WHEN** `getValidTransitionColumns` is called with `template` as `undefined`
- **THEN** an empty array is returned

#### Scenario: GCT-5 — fromColumnId not found in template returns empty array
- **WHEN** `getValidTransitionColumns` is called with a valid template but `fromColumnId` that does not match any column ID (e.g., stale state)
- **THEN** an empty array is returned

#### Scenario: GCT-6 — null/undefined fromColumnId returns empty array
- **WHEN** `getValidTransitionColumns` is called with `fromColumnId` as `null` or `undefined`
- **THEN** an empty array is returned

#### Scenario: GCT-7 — result order follows template column order, not allowedTransitions order
- **WHEN** `allowedTransitions: ["done", "plan"]` (reverse of template order) and template has `[backlog, plan, in_progress, done]`
- **THEN** the returned array is `[backlog(disabled), plan(false), done(false)]` — matching template position order

#### Scenario: GCT-8 — allowedTransitions referencing unknown column ID silently drops it
- **WHEN** `allowedTransitions: ["plan", "ghost-col"]` and `ghost-col` does not exist in the template
- **THEN** only `[current(disabled), plan(false)]` are returned; `ghost-col` is absent from the result

#### Scenario: GCT-9 — single-column template with empty allowedTransitions
- **WHEN** template has exactly 1 column with `allowedTransitions: []`
- **THEN** the result is `[col(disabled)]`

### Requirement: useColumnTransitions composable reactive behaviour is tested
The `useColumnTransitions` composable SHALL have unit tests confirming `selectableColumns` and `forbiddenColumnIds` update when reactive inputs change. Tests use Vue `ref()` directly without DOM.

#### Scenario: UCT-1 — forbiddenColumnIds is empty when allowedTransitions is undefined
- **WHEN** `useColumnTransitions` is used for a column with no `allowedTransitions`
- **THEN** `forbiddenColumnIds.value` is an empty `Set`

#### Scenario: UCT-2 — forbiddenColumnIds contains non-reachable columns when allowedTransitions is set
- **WHEN** `useColumnTransitions` is used for `backlog` with `allowedTransitions: ["plan"]` in a 5-column template
- **THEN** `forbiddenColumnIds.value` contains `in_progress`, `in_review`, `done` but not `backlog` and not `plan`

#### Scenario: UCT-3 — selectableColumns matches getValidTransitionColumns output
- **WHEN** `useColumnTransitions` is called and `selectableColumns.value` is read
- **THEN** it equals the result of calling `getValidTransitionColumns` with the same arguments

#### Scenario: UCT-4 — selectableColumns updates reactively when currentColumnId changes
- **WHEN** `currentColumnId` ref is updated from `backlog` (restricted) to `plan` (unrestricted)
- **THEN** `selectableColumns.value` updates to reflect the new column's filtering rules without re-calling the composable
