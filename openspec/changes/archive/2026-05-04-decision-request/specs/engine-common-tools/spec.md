## MODIFIED Requirements

### Requirement: Common tools are task management handlers shared across all engines
The system SHALL extract shared tool handlers into a common module at `src/bun/engine/common-tools.ts` and SHALL register those tools uniformly across all engines. The shared tools SHALL include: task tools `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`, `get_task`, `list_tasks`, and `get_board_summary`; todo tools `create_todo`, `edit_todo`, `update_todo_status`, `list_todos`, `get_todo`, and `reorganize_todos`; decision tools `decision_request`, `record_decision`, `list_decisions`, `update_decision`, and `delete_decision`; and interaction tool `ask_user`. The tool previously named `interview_me` SHALL be renamed to `decision_request` in all registrations. For the Claude engine, those tools SHALL be registered through the Claude SDK while Claude built-in tools continue to own file, shell, search, edit, and agent operations.

#### Scenario: Common tools are available in native engine
- **WHEN** the native engine runs an execution in a column that includes interactions in its tools config
- **THEN** shared tools including `decision_request` are offered alongside native engine tools

#### Scenario: Common tools are available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** shared tools including `decision_request` are registered via mapped common tool definitions without engine-exclusive duplicates

#### Scenario: Common tools are available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** shared tools including `decision_request` are registered with the SDK and available for model calls

#### Scenario: Common tool execution returns consistent results across engines
- **WHEN** `decision_request` is called with questions and optional context from any engine
- **THEN** shared execution invokes a common interview callback contract and produces equivalent waiting-user behavior across engines

### Requirement: Common tool handlers receive a context object
Each common tool handler SHALL receive a `CommonToolContext` containing scoped sub-objects: `task` (containing `taskId`, `boardId`, `taskContext`), `repos` (containing `todos: TodoRepository`, `decisions: DecisionRepository`), `workflow` (containing `transition`, `humanTurn` callbacks), and `runtime` (containing `interview` suspension callback, `cancellation` signal). The context SHALL be constructed via constructor injection of the repository instances. No handler SHALL access global state.

#### Scenario: Context populated by Copilot engine
- **WHEN** the Copilot engine executes a common tool call
- **THEN** it passes a `CommonToolContext` with `repos.decisions` populated and the interview suspension callback at `runtime.interview`

#### Scenario: Context populated by Claude engine
- **WHEN** the Claude engine executes a common tool call
- **THEN** it passes a `CommonToolContext` with `repos.decisions` populated and the interview suspension callback at `runtime.interview`

### Requirement: executeCommonTool returns a typed result object
The `executeCommonTool` function SHALL return `Promise<ToolExecutionResult>` where `ToolExecutionResult` is a discriminated union: `{ type: "result"; text: string }` for normal tool completions or `{ type: "suspend"; payload: string }` when the `decision_request` tool triggers execution suspension. Callers SHALL unwrap the `.text` field before treating the result as a plain string.

#### Scenario: Normal tool call returns result type
- **WHEN** a common tool (e.g. `create_todo`, `list_decisions`) completes successfully
- **THEN** `executeCommonTool` resolves to `{ type: "result", text: "<json-string>" }`

#### Scenario: decision_request triggers suspend type
- **WHEN** `decision_request` is called with questions
- **THEN** `executeCommonTool` resolves to `{ type: "suspend", payload: "<interview-payload>" }`

### Requirement: Common tool handlers accept typed Record<string, unknown> args
All common tool handlers SHALL accept `args: Record<string, unknown>` instead of `Record<string, string>`. Handlers SHALL cast to the expected type after AJV validation has confirmed the value is safe. The `toToolArgs()` serialisation helper SHALL remain removed from both engine adapters.

#### Scenario: Claude adapter passes raw args to executeCommonTool
- **WHEN** the Claude SDK invokes a common tool handler
- **THEN** the adapter passes the raw `Record<string, unknown>` args object directly to `executeCommonTool` without serialising to strings

#### Scenario: Copilot adapter passes raw args to executeCommonTool
- **WHEN** the Copilot engine invokes a common tool handler
- **THEN** the adapter passes the raw `Record<string, unknown>` args object directly to `executeCommonTool` without serialising to strings

## ADDED Requirements

### Requirement: record_decision tool allows silent AI decision logging
The system SHALL expose a `record_decision` tool that allows the AI to persist a decision record without suspending execution or prompting the user. The tool SHALL accept `question` (string), `answer` (string), and optional `weight` (enum: `critical` | `medium` | `easy`, default `medium`). On success, it SHALL create a `decision_records` row with `is_source_ai = 1` and return a confirmation string. The tool SHALL NOT trigger the `waiting_user` state.

#### Scenario: AI records decision without interrupting execution
- **WHEN** the AI calls `record_decision` with question, answer, and weight
- **THEN** a decision record is persisted with `is_source_ai = 1` and execution continues immediately

#### Scenario: Default weight is medium when omitted
- **WHEN** the AI calls `record_decision` without a `weight` field
- **THEN** the record is stored with `weight = "medium"`

### Requirement: list_decisions tool returns non-deleted records for the conversation
The system SHALL expose a `list_decisions` tool that returns all non-deleted `decision_records` for the current conversation, ordered by weight descending. Each record SHALL include `id`, `question`, `answer`, `weight`, `is_source_ai`, and `revision_count`.

#### Scenario: list_decisions returns current conversation records
- **WHEN** the AI calls `list_decisions`
- **THEN** it receives a JSON array of non-deleted records for the active conversationId

#### Scenario: Deleted records excluded from list
- **WHEN** a decision has been deleted and the AI calls `list_decisions`
- **THEN** the deleted record is not included in the result

### Requirement: update_decision tool appends a revision with required reason
The system SHALL expose an `update_decision` tool that accepts `id` (number), `new_answer` (string), and `reason` (string, REQUIRED). It SHALL call `DecisionRepository.updateRecord(id, newAnswer, reason)` which appends a revision row and increments `revision_count`. The `reason` field is required to prevent AI oscillation loops.

#### Scenario: update_decision persists revision with reason
- **WHEN** the AI calls `update_decision` with a valid id, new answer, and reason
- **THEN** a `decision_revisions` row is inserted and `revision_count` on the record is incremented

#### Scenario: update_decision without reason is rejected
- **WHEN** the AI calls `update_decision` without a `reason` field
- **THEN** `executeCommonTool` returns a validation error and no revision is written

### Requirement: delete_decision tool soft-deletes a record
The system SHALL expose a `delete_decision` tool that accepts `id` (number) and calls `DecisionRepository.deleteRecord(id)`, setting `is_deleted = 1`. The record SHALL remain in the database for audit purposes but SHALL be excluded from all read operations.

#### Scenario: Deleted record excluded from subsequent reads
- **WHEN** the AI calls `delete_decision` with a valid id
- **THEN** subsequent `list_decisions` calls do not include the deleted record
- **AND** the record remains in the database with `is_deleted = 1`
