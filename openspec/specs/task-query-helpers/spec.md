## Purpose
Provides shared database helper functions for fetching tasks and chat sessions with their associated conversation model, ensuring consistent model data in all WebSocket push events.

## Requirements

### Requirement: Shared DB helpers fetch task and chat-session with conversation model
The system SHALL provide two exported functions in `src/bun/db/task-queries.ts`:
- `fetchTaskWithModel(db: Database, taskId: string): Task | null` — executes a `SELECT` that joins `tasks`, `task_git_context`, and `conversations`, then maps the result with `mapTask()`
- `fetchChatSessionWithModel(db: Database, sessionId: string): ChatSession | null` — executes a `SELECT` that joins `chat_sessions` and `conversations`, then maps the result with `mapChatSession()`

Both functions SHALL return `null` when no row is found for the given ID. Both functions SHALL include `LEFT JOIN conversations c ON c.id = <entity>.conversation_id` so that `conversation_model` is populated in the mapper.

#### Scenario: fetchTaskWithModel returns task with model populated
- **WHEN** a task exists with a `conversation_id` whose `conversations.model` is `"claude-sonnet-4-6"`
- **THEN** `fetchTaskWithModel(db, taskId)` returns a `Task` with `model: "claude-sonnet-4-6"`

#### Scenario: fetchTaskWithModel returns null for missing task
- **WHEN** no task exists with the given ID
- **THEN** `fetchTaskWithModel(db, taskId)` returns `null`

#### Scenario: fetchTaskWithModel returns task with null model when conversation has no model
- **WHEN** a task's `conversations.model` is `NULL` in the DB
- **THEN** `fetchTaskWithModel(db, taskId)` returns a `Task` with `model: null`

#### Scenario: fetchChatSessionWithModel returns session with model populated
- **WHEN** a chat session exists with a `conversation_id` whose `conversations.model` is `"gpt-4.1"`
- **THEN** `fetchChatSessionWithModel(db, sessionId)` returns a `ChatSession` with `model: "gpt-4.1"`

#### Scenario: fetchChatSessionWithModel returns null for missing session
- **WHEN** no chat session exists with the given ID
- **THEN** `fetchChatSessionWithModel(db, sessionId)` returns `null`

### Requirement: All WebSocket-push paths use the shared helpers
The system SHALL ensure that every code path that calls `onTaskUpdated()` or `onSessionUpdated()` uses `fetchTaskWithModel` or `fetchChatSessionWithModel` respectively, rather than bare `SELECT * FROM tasks` or `SELECT * FROM chat_sessions` queries.

#### Scenario: Cancel execution broadcasts correct model
- **WHEN** a task execution is cancelled
- **THEN** the `task.updated` WebSocket event carries the task's current `model` value (not null)

#### Scenario: Shell approval broadcasts correct model
- **WHEN** a shell command approval is responded to
- **THEN** the `task.updated` WebSocket event carries the task's current `model` value (not null)

#### Scenario: Code review executor broadcasts correct model
- **WHEN** the code review executor updates task state
- **THEN** the `task.updated` WebSocket event carries the task's current `model` value (not null)

#### Scenario: Transition executor broadcasts correct model
- **WHEN** a task transitions between columns
- **THEN** the task returned from the transition handler carries the task's current `model` value (not null)

#### Scenario: Session setModel push carries correct model
- **WHEN** `chatSessions.setModel` is called and broadcasts `chatSession.updated`
- **THEN** the event's `model` field reflects the newly-set model value (not null)

#### Scenario: Session create/rename/archive events carry correct model
- **WHEN** any of `chatSessions.create`, `chatSessions.rename`, or `chatSessions.archive` complete
- **THEN** the `chatSession.updated` WebSocket event carries the session's current `model` value
