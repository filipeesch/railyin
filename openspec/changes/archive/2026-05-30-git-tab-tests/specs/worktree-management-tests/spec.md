## MODIFIED Requirements

### Requirement: Worktree tests navigate to the Git tab
All W-A through W-G Playwright tests SHALL navigate to the Git tab (not the Info tab) before asserting on worktree content.

#### Scenario: openGitTab helper navigates correctly
- **WHEN** test calls openGitTab(page, taskId)
- **THEN** the task drawer opens
- **AND** the "Git" tab button is clicked
- **AND** the `.task-tab-git` element is visible before assertions proceed

#### Scenario: W-A display state tests target .task-tab-git
- **WHEN** any W-A display state test runs
- **THEN** all selectors use `.task-tab-git` as the root scope (not `.task-tab-info`)

#### Scenario: W-B delete flow tests target .task-tab-git
- **WHEN** any W-B delete flow test runs
- **THEN** delete button, confirmation, and Cancel/Delete actions are scoped under `.task-tab-git`

#### Scenario: W-C create new branch tests target .task-tab-git
- **WHEN** any W-C create new branch test runs
- **THEN** `.wt-create-form` and create controls are scoped under `.task-tab-git`

#### Scenario: W-D create existing branch tests target .task-tab-git
- **WHEN** any W-D create existing branch test runs
- **THEN** branch dropdown and create controls are scoped under `.task-tab-git`

#### Scenario: W-E error and retry tests target .task-tab-git
- **WHEN** any W-E error/retry test runs
- **THEN** Retry button and error messages are scoped under `.task-tab-git`

#### Scenario: W-F guard rail tests target .task-tab-git
- **WHEN** any W-F guard rail test runs
- **THEN** disabled delete button and hidden create form are scoped under `.task-tab-git`
