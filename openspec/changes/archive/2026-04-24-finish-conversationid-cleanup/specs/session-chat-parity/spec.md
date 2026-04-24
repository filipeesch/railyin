## ADDED Requirements

### Requirement: Standalone sessions use the same merged conversation timeline model
Standalone chat sessions SHALL reuse the same merged conversation timeline model as task chat: persisted conversation history first, followed by a live execution tail while a session execution is active.

#### Scenario: Session history and live execution render as one conversation
- **WHEN** a standalone session has persisted messages and an active execution
- **THEN** the session chat renders them as one coherent conversation timeline rather than separate persisted and live sections

#### Scenario: Session live tail reconciles after completion
- **WHEN** the session execution completes and persisted conversation messages are available
- **THEN** the session chat replaces the live tail with persisted conversation content without duplicating timeline items
