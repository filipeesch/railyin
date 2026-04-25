## MODIFIED Requirements

### Requirement: ExecutionParams carries all context needed for an execution
The `ExecutionParams` type SHALL include: `executionId` (number), `taskId` (number | null), `prompt` (string — resolved prompt or user message), `systemInstructions` (optional string — resolved stage_instructions from the column config only; SHALL NOT include task title or description), `taskContext` (optional `{ title: string; description?: string }` — task identity context; populated by orchestrator when taskId is non-null), `workingDirectory` (string — worktree path), `model` (string — engine-specific model ID), `signal` (AbortSignal), and `conversationHistory` (optional `ConversationMessage[]` — for engines that rebuild context from history).

#### Scenario: ExecutionParams created for column transition
- **WHEN** a task transitions to a column with `on_enter_prompt`
- **THEN** the orchestrator constructs `ExecutionParams` with the resolved prompt, column's `stage_instructions` as `systemInstructions`, `taskContext` set from `task.title` and `task.description`, task worktree path, task model, a fresh AbortSignal, and a new executionId

#### Scenario: ExecutionParams created for human turn
- **WHEN** a user sends a message on a task
- **THEN** the orchestrator constructs `ExecutionParams` with the user message as `prompt`, column's `stage_instructions` as `systemInstructions`, `taskContext` set from the task row, task worktree path, task model, and a fresh AbortSignal

#### Scenario: systemInstructions does not contain task title or description
- **WHEN** the orchestrator builds `ExecutionParams` for any task execution
- **THEN** `systemInstructions` contains only the column's `stage_instructions` and MUST NOT include the task's title or description
