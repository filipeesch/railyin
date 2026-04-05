## Purpose
Provides per-task session memory notes that are periodically extracted from the conversation in the background and injected into every AI call, allowing the model to retain task-specific context across long conversations without relying solely on conversation history.

## Requirements

### Requirement: Session memory is extracted periodically in the background
The system SHALL, after every `SESSION_MEMORY_EXTRACTION_INTERVAL` (default: 5) completed AI turns for a task, trigger a non-blocking background AI call that reads the recent conversation and updates the task's session memory notes file. The main turn loop SHALL NOT await this extraction.

#### Scenario: Extraction fires after interval turns
- **WHEN** a task completes its Nth AI turn where N is a multiple of `SESSION_MEMORY_EXTRACTION_INTERVAL`
- **THEN** a background extraction call is initiated without delaying the next user interaction

#### Scenario: Extraction does not block main loop
- **WHEN** extraction is triggered
- **THEN** the main conversation loop continues immediately and is not awaited on the extraction result

#### Scenario: First extraction fires after interval turns
- **WHEN** a new task reaches its 5th completed AI turn
- **THEN** the first extraction is triggered and the notes file is created

### Requirement: Session memory notes are injected into every AI call system prompt
The system SHALL read the task's session memory notes file (if it exists and is non-empty) and append it as a labeled block to the system prompt before every AI API call. The injected block SHALL be truncated to `SESSION_MEMORY_MAX_CHARS` (default: 8,000) characters if the file exceeds that limit (truncating from the top, keeping the most recent content).

#### Scenario: Notes injected when file exists
- **WHEN** an AI call is assembled for a task that has a session memory notes file
- **THEN** the system prompt contains a `## Session Notes` block with the file contents appended

#### Scenario: Notes not injected when file absent
- **WHEN** an AI call is assembled for a task with no session memory notes file
- **THEN** the system prompt is not modified

#### Scenario: Oversized notes are truncated from the top
- **WHEN** the notes file exceeds `SESSION_MEMORY_MAX_CHARS`
- **THEN** only the last `SESSION_MEMORY_MAX_CHARS` characters are injected (most recent content preserved)

### Requirement: Notes file is stored per-task on disk
The system SHALL store each task's session memory notes at a deterministic path derived from the task ID: `~/.config/railyin/tasks/<taskId>/session-notes.md`.

#### Scenario: Notes file path is deterministic
- **WHEN** any component reads or writes session memory for a task
- **THEN** it uses the path `~/.config/railyin/tasks/<taskId>/session-notes.md`

#### Scenario: Notes file is written atomically
- **WHEN** extraction completes and the new notes content is ready
- **THEN** the file is written via atomic rename (write to temp, then rename) to prevent partial reads
