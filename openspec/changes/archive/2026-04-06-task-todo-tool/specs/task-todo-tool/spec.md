## ADDED Requirements

### Requirement: Model can create todos
The system SHALL expose a `create_todo` tool that allows the model to create a new todo item scoped to the current task. The tool SHALL accept a required `title` and optional `context` field, and SHALL return a stable integer `id` for the created item.

#### Scenario: Create todo without context
- **WHEN** the model calls `create_todo` with a title only
- **THEN** a new todo is persisted in `task_todos` with status `not-started` and a stable integer id is returned

#### Scenario: Create todo with context
- **WHEN** the model calls `create_todo` with a title and a context string
- **THEN** the todo is persisted with the context field populated, retrievable via `get_todo`

### Requirement: Model can retrieve a todo by id
The system SHALL expose a `get_todo` tool that returns the full todo record for a given id, including `id`, `title`, `status`, `context`, and `result`.

#### Scenario: Get existing todo
- **WHEN** the model calls `get_todo` with a valid id
- **THEN** the full todo record is returned including context and result fields (null if not set)

#### Scenario: Get non-existent todo
- **WHEN** the model calls `get_todo` with an id that does not exist for the current task
- **THEN** an error string is returned indicating the todo was not found

### Requirement: Model can update a todo
The system SHALL expose an `update_todo` tool that allows the model to update any combination of `title`, `status`, `context`, and `result` fields by id. Status values SHALL be: `not-started`, `in-progress`, `completed`.

#### Scenario: Update status to in-progress
- **WHEN** the model calls `update_todo` with a valid id and `status: "in-progress"`
- **THEN** the todo's status is updated in the DB and the next injected system block reflects the new status

#### Scenario: Write result after completion
- **WHEN** the model or a sub-agent calls `update_todo` with a `result` string and `status: "completed"`
- **THEN** the result is persisted and readable via `get_todo`, surviving future compaction cycles

#### Scenario: Update non-existent todo
- **WHEN** the model calls `update_todo` with an id that does not exist for the current task
- **THEN** an error string is returned indicating the todo was not found

### Requirement: Model can delete a todo
The system SHALL expose a `delete_todo` tool that permanently removes a todo by id.

#### Scenario: Delete completed todo
- **WHEN** the model calls `delete_todo` with a valid id
- **THEN** the todo is removed from `task_todos` and no longer appears in the injected system block

### Requirement: Model can list todos
The system SHALL expose a `list_todos` tool that returns all todos for the current task as an array of `{ id, title, status }` objects. This tool is the primary entry point for sub-agents that do not receive the system injection.

#### Scenario: List todos during active run
- **WHEN** the model or a sub-agent calls `list_todos`
- **THEN** all todos for the current task are returned with id, title, and status only

#### Scenario: List todos when none exist
- **WHEN** the model calls `list_todos` and no todos have been created
- **THEN** an empty array is returned

### Requirement: Todos are injected as a system block on every API call
The system SHALL inject all current todos for the task as a system message block before the conversation history on every AI API call. The injection SHALL include only `id`, `title`, and `status` — not `context` or `result`. The block SHALL be omitted entirely when the task has no todos.

#### Scenario: Injection when todos exist
- **WHEN** an AI API call is assembled and the task has one or more todos
- **THEN** a system message block listing todos (id, title, status) is prepended before conversation history

#### Scenario: Injection survives compaction
- **WHEN** a compaction has occurred and a subsequent AI call is assembled
- **THEN** the todo system block is still injected fresh from the DB, unaffected by the compaction summary

#### Scenario: No injection when todos list is empty
- **WHEN** an AI API call is assembled and the task has no todos
- **THEN** no todo system block is included in the assembled messages

### Requirement: Todos tool group is available to sub-agents
The system SHALL include the `todos` tool group in the list of available tool groups that can be granted to sub-agents. Sub-agents SHALL be able to call `list_todos` and `get_todo` to discover and retrieve todo context, and `update_todo` to write results.

#### Scenario: Sub-agent retrieves context for delegated todo
- **WHEN** a sub-agent is spawned with access to the `todos` group
- **THEN** the sub-agent can call `list_todos` to discover todo IDs and `get_todo(id)` to retrieve the context field for its delegated item

#### Scenario: Sub-agent writes result on completion
- **WHEN** a sub-agent completes its work
- **THEN** the sub-agent can call `update_todo` to set the `result` field and status to `completed`

### Requirement: Todo progress is visible in the chat UI
The system SHALL display a collapsible todo panel above the chat message input. The panel SHALL show `{completed} / {total}` progress in its collapsed state and the full list (title + status indicator) in its expanded state. The panel SHALL be hidden when no todos exist.

#### Scenario: Collapsed panel shows progress
- **WHEN** todos exist and the panel is collapsed
- **THEN** the panel header shows a count like "2 / 4 · Todos" indicating completed vs. total

#### Scenario: Expanded panel shows full list
- **WHEN** the user expands the panel
- **THEN** each todo is displayed with a status icon (✓ completed, ● in-progress, ○ not-started) and its title

#### Scenario: Panel is hidden with no todos
- **WHEN** the task has no todos
- **THEN** the todo panel is not rendered in the UI
