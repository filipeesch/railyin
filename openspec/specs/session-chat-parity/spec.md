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

### Requirement: Standalone sessions use the same merged conversation timeline model
Standalone chat sessions SHALL reuse the same merged conversation timeline model as task chat: persisted conversation history first, followed by a live execution tail while a session execution is active.

#### Scenario: Session history and live execution render as one conversation
- **WHEN** a standalone session has persisted messages and an active execution
- **THEN** the session chat renders them as one coherent conversation timeline rather than separate persisted and live sections

#### Scenario: Session live tail reconciles after completion
- **WHEN** the session execution completes and persisted conversation messages are available
- **THEN** the session chat replaces the live tail with persisted conversation content without duplicating timeline items
