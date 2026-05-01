## ADDED Requirements

### Requirement: Task Drawer workflow Select is Playwright-tested for allowedTransitions enforcement
Playwright tests in `e2e/ui/task-toolbar.spec.ts` SHALL verify the Select option set and disabled state are driven by `allowedTransitions`. Tests use `setupBoardWithTemplate` with a restricted template (backlog → allowedTransitions: ["plan"]).

#### Scenario: TT-12 — unrestricted column shows all columns in Select
- **WHEN** a task is in a column with no `allowedTransitions` configured and the user opens the workflow Select
- **THEN** the Select dropdown contains all 5 template columns

#### Scenario: TT-13 — restricted column shows only current plus allowed targets
- **WHEN** a task is in `backlog` (allowedTransitions: ["plan"]) and the user opens the workflow Select
- **THEN** the Select dropdown contains exactly 2 options: "Backlog" and "Plan"

#### Scenario: TT-14 — current column option is disabled in Select
- **WHEN** the workflow Select is opened for a task in `backlog`
- **THEN** the "Backlog" option has `aria-disabled="true"` and cannot be selected

#### Scenario: TT-15 — forbidden columns are absent from Select options
- **WHEN** a task is in `backlog` with `allowedTransitions: ["plan"]` and the Select is opened
- **THEN** no option for "In Progress", "In Review", or "Done" is present in the dropdown

#### Scenario: TT-16 — selecting an allowed option triggers tasks.transition
- **WHEN** the user opens the Select and clicks the "Plan" option
- **THEN** `tasks.transition` is called with the correct `taskId` and `toState: "plan"`

#### Scenario: TT-17 — frozen column (allowedTransitions=[]) shows only current column disabled
- **WHEN** a task is in a column configured with `allowedTransitions: []` and the Select is opened
- **THEN** the Select contains exactly 1 option (the current column) and it is disabled (`aria-disabled="true"`)
