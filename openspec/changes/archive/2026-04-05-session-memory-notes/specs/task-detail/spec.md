## ADDED Requirements

### Requirement: Task detail drawer shows Session Notes
The system SHALL display a "Session Notes" section in the task detail drawer showing the current contents of the task's session memory notes file. The section SHALL be collapsed by default and expandable by the user.

#### Scenario: Session Notes section visible when notes exist
- **WHEN** the task detail drawer opens and the task has a session memory notes file
- **THEN** a collapsed "Session Notes" section is visible in the drawer

#### Scenario: Session Notes section hidden when no notes
- **WHEN** the task detail drawer opens and the task has no session memory notes file
- **THEN** no Session Notes section is rendered

#### Scenario: User can expand to read notes
- **WHEN** the user clicks the "Session Notes" section header
- **THEN** the full notes content is displayed as rendered markdown

#### Scenario: Notes content is read-only
- **WHEN** the Session Notes section is expanded
- **THEN** there is no edit control — the content is read-only display
