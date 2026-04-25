## Purpose
Defines how task identity context (title and description) is carried through ExecutionParams and injected by engine adapters to ensure the model receives task context with appropriate attention priority.

## Requirements

### Requirement: ExecutionParams carries task identity as a dedicated typed field
The `ExecutionParams` interface SHALL include an optional `taskContext?: { title: string; description?: string }` field that carries the task's identity information separately from `systemInstructions`. This field SHALL be populated by the orchestrator when executing a task (i.e., when `taskId` is non-null) and SHALL be `undefined` for chat sessions.

#### Scenario: Task execution populates taskContext
- **WHEN** the orchestrator builds `ExecutionParams` for a task execution
- **THEN** `taskContext.title` is set to the task's title and `taskContext.description` is set to the task's description (or `undefined` if blank)

#### Scenario: Chat session leaves taskContext undefined
- **WHEN** the orchestrator builds `ExecutionParams` for a standalone chat session
- **THEN** `taskContext` is `undefined`

### Requirement: Each engine adapter owns the injection strategy for taskContext
Engines that receive a populated `taskContext` SHALL inject the task identity in the manner most appropriate for their architecture. The strategy chosen SHALL ensure the model receives the task block with higher attention priority than generic stage instructions.

#### Scenario: Claude adapter injects taskContext via SessionStart hook
- **WHEN** the Claude adapter receives `ExecutionParams` with a non-null `taskContext`
- **THEN** it registers a `SessionStart` hook that returns `additionalContext` containing a formatted `## Task` block (title + optional description)
- **AND** the hook fires on both new sessions and resumed sessions

#### Scenario: Copilot engine prepends taskContext to system message
- **WHEN** the Copilot engine receives `ExecutionParams` with a non-null `taskContext`
- **THEN** it prepends the formatted task block to the `systemMessage.content` ahead of any stage instructions

#### Scenario: Engine ignores taskContext when undefined
- **WHEN** an engine receives `ExecutionParams` with `taskContext` undefined
- **THEN** it behaves identically to the current implementation with no task block injected
