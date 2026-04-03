## MODIFIED Requirements

### Requirement: Execution result updates task execution state

The system SHALL update a task's `execution_state` based on the structured result returned by or intercepted during AI execution. Valid terminal states are `completed`, `failed`, and `waiting_user`.

#### Scenario: Completed execution updates state to completed

- **WHEN** an execution finishes streaming with a non-empty response and no suspension
- **THEN** the task's `execution_state` is set to `completed`

#### Scenario: Failed execution updates state to failed

- **WHEN** an execution encounters an error or an unrecoverable condition
- **THEN** the task's `execution_state` is set to `failed`

#### Scenario: ask_user tool call transitions to waiting_user

- **WHEN** the AI calls the `ask_user` tool during the tool loop
- **THEN** the engine intercepts the call, appends an `ask_user_prompt` message to the conversation, sets `execution_state = 'waiting_user'`, and exits without streaming a response

#### Scenario: User answer resumes from waiting_user

- **WHEN** a task has `execution_state = 'waiting_user'` and the user sends a message
- **THEN** `handleHumanTurn` runs as normal — the user's answer is appended as a `user` message and the model continues with full conversation context

## ADDED Requirements

### Requirement: Tool set offered to model is determined per column

The system SHALL filter `TOOL_DEFINITIONS` to only include tools named in the current column's `tools` configuration before building the AI request. When no `tools` key is present in the column config, the default set (`read_file`, `list_dir`, `run_command`) SHALL be used.

#### Scenario: Column tools list controls what model receives

- **WHEN** an execution runs in a column with `tools: [read_file, ask_user]`
- **THEN** the AI request includes only `read_file` and `ask_user` definitions, regardless of what other tools are registered

#### Scenario: No tools key falls back to defaults

- **WHEN** an execution runs in a column with no `tools` key and a worktree is available
- **THEN** the AI request includes `read_file`, `list_dir`, and `run_command`
