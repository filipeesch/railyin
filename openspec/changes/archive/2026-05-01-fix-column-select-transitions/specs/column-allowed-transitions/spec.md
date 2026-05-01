## ADDED Requirements

### Requirement: Task Drawer workflow Select respects allowedTransitions
The workflow column `Select` in the Task Drawer SHALL show only the current column (as a disabled option) and valid transition targets based on the current column's `allowedTransitions`. Columns that are not reachable SHALL be excluded from the Select options entirely.

#### Scenario: Select shows all columns with current disabled when no allowedTransitions configured
- **WHEN** a task is in a column with no `allowedTransitions` configured
- **THEN** the workflow Select shows all board columns; the current column is present but disabled (non-selectable); all other columns are enabled

#### Scenario: Select shows only valid targets when allowedTransitions is set
- **WHEN** a task is in a column with `allowedTransitions: ["review", "done"]`
- **THEN** the workflow Select shows the current column (disabled) plus "review" and "done"; all other columns are absent from the list

#### Scenario: Select shows only the current column when allowedTransitions is empty
- **WHEN** a task is in a column with `allowedTransitions: []`
- **THEN** the workflow Select shows only the current column as a disabled option; no other columns are shown

#### Scenario: Selecting a valid target triggers transition
- **WHEN** a user selects a reachable column from the workflow Select
- **THEN** `tasks.transition` is called with the selected column id and the task moves to that column

#### Scenario: Transition to the current column is a no-op
- **WHEN** the `transition` function is called programmatically with the current column id
- **THEN** no API call is made and the task state is unchanged
