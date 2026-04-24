## Purpose
Defines parity requirements so standalone sessions reuse the same core chat experience as task chat.

## Requirements

### Requirement: Standalone sessions expose the shared chat surface
The system SHALL provide standalone chat sessions with the same core conversation input and rendering experience used by task chat, with workspace-scoped context replacing task-scoped context where necessary.

#### Scenario: Session chat uses shared conversation surface
- **WHEN** the user opens a standalone chat session
- **THEN** the session renders the shared conversation body and shared chat editor rather than a reduced session-only input path

#### Scenario: Session chat preserves session-specific shell around shared chat
- **WHEN** the user opens a standalone chat session
- **THEN** the drawer still shows the session header and session actions without adding task-only tabs or task metadata panels
