## MODIFIED Requirements

### Requirement: Session memory notes are injected into every AI call as a variable user-turn context block
The system SHALL read the task's session memory notes file (if it exists and is non-empty) and inject it as a labeled `<session_context>` block appended to the **final user message** of the assembled context, rather than into the stable system block. The injected block SHALL be truncated to `SESSION_MEMORY_MAX_CHARS` (default: 8,000) characters if the file exceeds that limit (truncating from the top, keeping the most recent content). Injecting notes into the user message instead of the system block ensures the stable system prefix (stage instructions, task, worktree) is never invalidated by note updates.

#### Scenario: Notes injected into final user message when file exists
- **WHEN** an AI call is assembled for a task that has a session memory notes file
- **THEN** the final user message content is appended with `\n\n<session_context>\n<notes content>\n</session_context>` and the system blocks do NOT contain session notes

#### Scenario: Notes not injected when file absent
- **WHEN** an AI call is assembled for a task with no session memory notes file
- **THEN** the user message is not modified and no `<session_context>` block appears

#### Scenario: Oversized notes are truncated from the top
- **WHEN** the notes file exceeds `SESSION_MEMORY_MAX_CHARS`
- **THEN** only the last `SESSION_MEMORY_MAX_CHARS` characters are injected (most recent content preserved)

#### Scenario: System hash remains stable when notes update
- **WHEN** session memory extraction fires and updates the notes file
- **THEN** the next round's stable system block content is identical to the previous round's (hash unchanged) and no cache-break warning is emitted for the system component
