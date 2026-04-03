## Purpose
The workflow engine drives automated AI execution when tasks enter workflow columns, processes human turns, and manages execution lifecycle and state transitions.

## Requirements

### Requirement: Workflow columns are defined in YAML configuration
The system SHALL load workflow column definitions from YAML files. Each column definition SHALL include at minimum an `id`, `label`, and optionally an `on_enter_prompt` and `stage_instructions`.

#### Scenario: Columns load from YAML at startup
- **WHEN** the application starts
- **THEN** workflow templates are read from YAML files and available for board assignment

#### Scenario: Column without on_enter_prompt is valid
- **WHEN** a column is defined in YAML without an `on_enter_prompt`
- **THEN** tasks moved into that column have their `execution_state` set to `idle` and no AI call is made

### Requirement: Entering a column triggers on_enter_prompt execution
The system SHALL automatically execute a column's `on_enter_prompt` when a task enters that column, if the prompt is configured. This is the only automatic trigger in the MVP — all other executions are human-initiated.

#### Scenario: Prompt runs on column entry
- **WHEN** a task is moved to a column with a configured `on_enter_prompt`
- **THEN** a new execution is created, `execution_state` is set to `running`, and the prompt begins executing immediately

#### Scenario: No prompt means idle state
- **WHEN** a task is moved to a column with no `on_enter_prompt`
- **THEN** `execution_state` is set to `idle` and no execution is created

### Requirement: Stage instructions are injected into every AI call in a column
The system SHALL inject a column's `stage_instructions` as a system message into every AI call made while a task is in that column. This applies to both `on_enter_prompt` executions and subsequent human turn messages.

#### Scenario: Stage instructions injected on prompt execution
- **WHEN** the on_enter_prompt runs for a column with stage_instructions configured
- **THEN** the AI request includes the stage_instructions as the first system message

#### Scenario: Stage instructions injected on human turn
- **WHEN** a user sends a follow-up message in the task chat while the task is in a column with stage_instructions
- **THEN** the AI request includes the stage_instructions as a system message

#### Scenario: No stage_instructions means no injection
- **WHEN** a column does not define stage_instructions
- **THEN** no additional system message is prepended to AI calls for tasks in that column

### Requirement: Workflow engine ships with built-in templates
The system SHALL include at least one built-in workflow YAML template that users can use without creating custom configuration.

#### Scenario: Default template is available on first launch
- **WHEN** a user creates their first board
- **THEN** a built-in workflow template (e.g., Backlog → Plan → In Progress → In Review → Done) is available for selection

### Requirement: Execution result updates task execution state
The system SHALL update a task's `execution_state` based on the structured result returned by the AI execution. The result SHALL include a `status` field that maps to valid execution states.

#### Scenario: Completed execution updates state to completed
- **WHEN** an execution returns status `completed`
- **THEN** the task's `execution_state` is set to `completed`

#### Scenario: Failed execution updates state to failed
- **WHEN** an execution encounters an error or returns status `failed`
- **THEN** the task's `execution_state` is set to `failed`

#### Scenario: Waiting execution pauses for human input
- **WHEN** an execution returns status `waiting_user`
- **THEN** the task's `execution_state` is set to `waiting_user` and the board card reflects this state

### Requirement: Frontend is notified immediately on execution state changes
The system SHALL push task state updates to the frontend via IPC whenever execution state changes — including when execution begins and when it completes or fails.

#### Scenario: Running state pushed on human turn
- **WHEN** a user sends a chat message that starts a new execution
- **THEN** a `task.updated` event is sent to the frontend immediately after `execution_state` is set to `running`

#### Scenario: Completed state pushed after stream finishes
- **WHEN** the AI finishes streaming its response and the DB is updated
- **THEN** a `task.updated` event is sent so the board card reflects the final state
