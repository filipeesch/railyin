## ADDED Requirements

### Requirement: Playwright coverage for stream state isolation between concurrent conversations
The system SHALL have Playwright test coverage verifying that two open conversations maintain independent stream state and that switching drawers does not cause cross-contamination of streamed content.

#### Scenario: Stream content from task A is not visible in task B
- **WHEN** task A's conversation has streamed "Hello from A" and the user opens task B's drawer
- **THEN** task B's `.conv-body` does not contain "Hello from A"

#### Scenario: Stream state for task A persists after switching to session and back
- **WHEN** task A has streamed content, the user opens a session drawer, then returns to task A
- **THEN** task A's streamed content is still visible in the conversation body
