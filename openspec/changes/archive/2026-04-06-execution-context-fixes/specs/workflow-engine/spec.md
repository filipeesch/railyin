## ADDED Requirements

### Requirement: Worktree context tool descriptions are scoped to column tools
The system SHALL generate the tool description block in the worktree context system message dynamically based on the column's configured `tools` array. Only tools available to the current column SHALL appear in the natural-language description block. When a tool group is not in the column's config, its description lines SHALL be omitted entirely.

#### Scenario: Read-only column omits write tool descriptions
- **WHEN** a column defines `tools: [read, search, web, interactions, agents]`
- **THEN** the worktree context system message includes descriptions for read, search, web, interaction, and agent tools, but does NOT include write tool descriptions (write_file, patch_file, delete_file, rename_file)

#### Scenario: Column with all groups includes all descriptions
- **WHEN** a column defines `tools: [read, write, search, web, shell, interactions, agents]`
- **THEN** the worktree context system message includes descriptions for all tool groups

#### Scenario: Column with no tools key uses default set descriptions
- **WHEN** a column has no `tools` key configured
- **THEN** the worktree context system message includes descriptions only for the default tools (read_file, list_dir, run_command)

### Requirement: Resolved on_enter_prompt is persisted as a user message
The engine SHALL persist the resolved `on_enter_prompt` content to `conversation_messages` as a `user` message with `sender = 'prompt'` before passing it to the AI execution. This ensures the prompt content survives in conversation history across subsequent human turns and compaction.

#### Scenario: Prompt content appears in conversation history on follow-up turn
- **WHEN** a task enters a column with `on_enter_prompt: /opsx-explore`, the prompt resolves, and the user later sends a follow-up message
- **THEN** the conversation history loaded from DB includes the full resolved explore prompt as a `user` message before the AI's response

#### Scenario: Prompt message uses sender 'prompt' to distinguish from human messages
- **WHEN** the engine persists the resolved `on_enter_prompt` content
- **THEN** the message has `type = 'user'` and `sender = 'prompt'`

#### Scenario: Duplicate prompt is not injected by assembleMessages
- **WHEN** `runExecution` receives the raw slug as `newMessage` but the resolved prompt is already in the conversation history
- **THEN** `assembleMessages` does not add a duplicate user message (existing dedup logic handles this)

## MODIFIED Requirements

### Requirement: Entering a column triggers on_enter_prompt execution
The system SHALL automatically execute a column's `on_enter_prompt` when a task enters that column, if the prompt is configured. Before starting the execution, the engine SHALL update the task's `model` field to the column's configured `model`, or the workspace default if the column has none. The engine SHALL resolve the `on_enter_prompt` slash reference and persist the resolved content as a `user` message with `sender = 'prompt'` to `conversation_messages` before calling `runExecution`.

#### Scenario: Prompt runs on column entry
- **WHEN** a task is moved to a column with a configured `on_enter_prompt`
- **THEN** a new execution is created, `execution_state` is set to `running`, and the prompt begins executing immediately

#### Scenario: No prompt means idle state
- **WHEN** a task is moved to a column with no `on_enter_prompt`
- **THEN** `execution_state` is set to `idle` and no execution is created

#### Scenario: Task model updated to column model on entry
- **WHEN** a task enters a column with a `model` field defined
- **THEN** `task.model` is set to the column's model before execution begins

#### Scenario: Task model reset to workspace default when column has no model
- **WHEN** a task enters a column with no `model` field
- **THEN** `task.model` is set to the workspace `ai.model` value

#### Scenario: Resolved prompt is persisted before execution
- **WHEN** `handleTransition` fires for a column with `on_enter_prompt`
- **THEN** the engine resolves the slash reference, persists the resolved content as a `user` message with `sender = 'prompt'`, and then calls `runExecution`
