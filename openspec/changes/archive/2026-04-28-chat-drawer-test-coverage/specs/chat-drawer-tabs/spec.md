## ADDED Requirements

### Requirement: Playwright coverage for toolbar conditional controls
The system SHALL have Playwright test coverage verifying that the toolbar's conditional controls (workflow select, terminal button, code editor button, retry button) are shown or hidden based on actual task state properties, and that their interactions produce the expected side effects.

#### Scenario: Workflow select value reflects current column
- **WHEN** the task drawer opens for a task with `workflowState: "in-progress"`
- **THEN** the `.workflow-select` element shows "in-progress" as its selected value

#### Scenario: Workflow select change triggers transition
- **WHEN** the user selects a new column from the workflow select
- **THEN** `tasks.transition` is called with the new column id

#### Scenario: Terminal button hidden when worktreePath is null
- **WHEN** the task has `worktreePath: null`
- **THEN** no element matching the terminal button icon is present in the DOM

#### Scenario: Terminal button visible when worktreePath is set
- **WHEN** the task has `worktreePath: "/tmp/test"`
- **THEN** the terminal button is visible in the toolbar

#### Scenario: Code editor button hidden when worktreePath is null
- **WHEN** the task has `worktreePath: null`
- **THEN** the code editor button is not present in the DOM

#### Scenario: Code editor button visible when worktreePath is set
- **WHEN** the task has `worktreePath: "/tmp/test"`
- **THEN** the code editor button is visible in the toolbar

#### Scenario: Retry button absent for non-failed tasks
- **WHEN** the task has `executionState: "idle"`
- **THEN** no retry button is rendered

#### Scenario: Retry button visible for failed tasks
- **WHEN** the task has `executionState: "failed"`
- **THEN** the retry button is visible in the toolbar
