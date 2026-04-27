## MODIFIED Requirements

### Requirement: Common tools are task management handlers shared across all engines
The system SHALL extract shared tool handlers into a common module at src/bun/engine/common-tools.ts and SHALL register those tools uniformly across all engines. The shared tools SHALL include task tools create_task, edit_task, delete_task, move_task, message_task, get_task, list_tasks, and get_board_summary; todo tools create_todo, edit_todo, update_todo_status, list_todos, get_todo, and reorganize_todos; and interaction tool interview_me. For the Claude engine, those tools SHALL be registered through the Claude SDK while Claude built-in tools continue to own file, shell, search, edit, and agent operations.

#### Scenario: Common tools are available in native engine
- **WHEN** the native engine runs an execution in a column that includes interactions in its tools config
- **THEN** shared tools including interview_me are offered alongside native engine tools

#### Scenario: Common tools are available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** shared tools including interview_me are registered via mapped common tool definitions without engine-exclusive duplicates

#### Scenario: Common tools are available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** shared tools including interview_me are registered with the SDK and available for model calls

#### Scenario: Common tool execution returns consistent results across engines
- **WHEN** interview_me is called with questions and optional context from any engine
- **THEN** shared execution invokes a common interview callback contract and produces equivalent waiting-user behavior across engines

### Requirement: Common tool handlers accept typed Record<string, unknown> args
All common tool handlers — including those in `board-tools.ts`, `lsp-tools.ts`, and `common-tools.ts` — SHALL accept `args: Record<string, unknown>` instead of `Record<string, string>`. Handlers SHALL cast to the expected type after AJV validation has confirmed the value is safe (e.g. `args.task_id as number`). The `toToolArgs()` serialisation helper SHALL be removed from both `engine/claude/tools.ts` and `engine/copilot/tools.ts`.

#### Scenario: Claude adapter passes raw args to executeCommonTool
- **WHEN** the Claude SDK invokes a common tool handler
- **THEN** the adapter passes the raw `Record<string, unknown>` args object directly to `executeCommonTool` without serialising to strings

#### Scenario: Copilot adapter passes raw args to executeCommonTool
- **WHEN** the Copilot engine invokes a common tool handler
- **THEN** the adapter passes the raw `Record<string, unknown>` args object directly to `executeCommonTool` without serialising to strings

#### Scenario: Board tool handler casts typed args safely
- **WHEN** a board tool (e.g. `execGetTask`) receives args that have passed AJV validation
- **THEN** it accesses numeric fields via `args.field as number` without parseInt and the correct value is used

### Requirement: interview_me questions array has minItems: 1 constraint
The `interview_me` tool definition SHALL declare `minItems: 1` on the `questions` array property so that the AJV gate rejects empty arrays. The previous ad-hoc check (`questions.length === 0`) relied on runtime logic; the schema must encode this constraint so validation is schema-driven.

#### Scenario: Empty questions array is rejected by validator
- **WHEN** a model calls `interview_me` with `questions: []`
- **THEN** `executeCommonTool` returns an error message indicating at least one question is required, and the interview callback is NOT invoked

#### Scenario: questions array with one item passes validation
- **WHEN** a model calls `interview_me` with a well-formed single question
- **THEN** `executeCommonTool` proceeds to the interview callback

### Requirement: reorganize_todos items field accepts a typed array without JSON.parse fallback
The `reorganize_todos` handler SHALL accept `args.items` as a native array (`Array<{id: number; number: number}>`) without falling back to `JSON.parse`. After the `toToolArgs()` round-trip is removed, the SDK delivers the value as a real array; the handler SHALL cast directly to the expected type.

#### Scenario: items passed as real array is accepted
- **WHEN** a model calls `reorganize_todos` with `items: [{id: 1, number: 10}]`
- **THEN** the handler uses the array directly and the todo ordering is updated

### Requirement: update_todo_status status field has an explicit enum constraint
The `update_todo_status` tool definition SHALL declare `status` as an enum field with valid values `pending`, `in-progress`, `done`, `blocked`, and `deleted`. This makes the field self-documenting and enables the generic AJV validator to catch invalid values.

#### Scenario: Invalid status value is rejected by validator
- **WHEN** a model calls `update_todo_status` with `status: "finished"`
- **THEN** `executeCommonTool` returns `"Invalid value 'finished' for 'status'. Valid values: pending, in-progress, done, blocked, deleted"` without executing the handler

#### Scenario: Valid status value passes validation
- **WHEN** a model calls `update_todo_status` with `status: "done"`
- **THEN** `executeCommonTool` proceeds to execute the handler and the todo is updated
