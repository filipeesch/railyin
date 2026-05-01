## Purpose
Defines the `useColumnTransitions` shared composable and its underlying pure function `getValidTransitionColumns`, which centralize all column-transition filtering logic for use across the board drag UI and the task drawer Select.

## Requirements

### Requirement: A shared composable encapsulates column-transition filtering logic
A `useColumnTransitions(template, currentColumnId)` composable SHALL be available in `src/mainview/composables/useColumnTransitions.ts`. It SHALL export:
- A pure function `getValidTransitionColumns(template, fromColumnId)` returning `TransitionColumn[]` (a `WorkflowColumn` extended with `disabled: boolean`).
- The `useColumnTransitions` composable wrapping that function in Vue reactivity, returning `{ selectableColumns, forbiddenColumnIds }`.

#### Scenario: Pure function returns all columns with current disabled when no allowedTransitions set
- **WHEN** `getValidTransitionColumns` is called for a column with `allowedTransitions: undefined`
- **THEN** all columns in the template are returned; the current column has `disabled: true`; all others have `disabled: false`

#### Scenario: Pure function returns only current column when allowedTransitions is empty
- **WHEN** `getValidTransitionColumns` is called for a column with `allowedTransitions: []`
- **THEN** only the current column is returned, with `disabled: true`

#### Scenario: Pure function returns current plus allowed targets
- **WHEN** `getValidTransitionColumns` is called for a column with `allowedTransitions: ["col-a", "col-b"]`
- **THEN** the result contains the current column (`disabled: true`), `col-a` (`disabled: false`), and `col-b` (`disabled: false`); no other columns are included

#### Scenario: Pure function returns empty array when template is undefined
- **WHEN** `getValidTransitionColumns` is called with `template` as `undefined`
- **THEN** an empty array is returned

#### Scenario: forbiddenColumnIds contains columns not reachable from current column
- **WHEN** `useColumnTransitions` is used for a column with `allowedTransitions: ["col-a"]` in a template with `["backlog", "col-a", "col-b"]`
- **THEN** `forbiddenColumnIds` contains `"col-b"` but not `"col-a"` and not the source column

#### Scenario: forbiddenColumnIds is empty when allowedTransitions is undefined
- **WHEN** `useColumnTransitions` is used for a column with no `allowedTransitions`
- **THEN** `forbiddenColumnIds` is an empty `Set`
