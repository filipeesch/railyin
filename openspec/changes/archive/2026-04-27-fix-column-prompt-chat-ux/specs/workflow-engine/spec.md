## MODIFIED Requirements

### Requirement: Entering a column triggers on_enter_prompt execution
The system SHALL automatically execute a column's `on_enter_prompt` when a task enters that column, if the prompt is configured. Before starting the execution, the orchestrator SHALL update the task's `model` field to the column's configured `model`, or keep the task's current model if the column has none. The orchestrator SHALL append a `transition_event` message that records the workflow move and, for prompted columns, the entered-column instruction detail needed for conversation rendering. The orchestrator SHALL construct `ExecutionParams` for the active engine and delegate to `ExecutionEngine.execute()`.

For prompted column entry, the workflow metadata SHALL preserve both the prompt prepared for execution and the authored source prompt. When the source prompt is slash-based, the task chat SHALL be able to display the authored slash reference while keeping the resolved prompt body available in metadata. New prompted column-entry history SHALL NOT require a separate visible `user` prompt message as the primary explanation of what ran.

#### Scenario: Prompt runs on column entry
- **WHEN** a task is moved to a column with a configured `on_enter_prompt`
- **THEN** the orchestrator creates `ExecutionParams` for that prompt and calls `engine.execute(params)`; `execution_state` is set to `running`

#### Scenario: No prompt means idle state
- **WHEN** a task is moved to a column with no `on_enter_prompt`
- **THEN** `execution_state` is set to `idle` and no execution is created

#### Scenario: Task model updated to column model on entry
- **WHEN** a task enters a column with a `model` field defined
- **THEN** `task.model` is set to the column's model before execution begins

#### Scenario: Task model falls back to the current task model when column has no model
- **WHEN** a task enters a column with no `model` field
- **THEN** `task.model` keeps the task's current model value instead of resetting to a workspace default

#### Scenario: Prompted transition stores entered-column instruction detail
- **WHEN** the orchestrator fires for a column with `on_enter_prompt`
- **THEN** the appended `transition_event` metadata contains the instruction detail needed for the task chat disclosure, including hidden source metadata for debugging

#### Scenario: Prompted transition does not depend on a standalone visible prompt message
- **WHEN** a task enters a prompted column
- **THEN** the user-visible history of that transition can be rendered from the `transition_event` alone without requiring a separate visible `user(role="prompt")` row
