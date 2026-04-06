## Purpose
The workflow engine drives automated AI execution when tasks enter workflow columns, processes human turns, and manages execution lifecycle and state transitions.

## Requirements

### Requirement: Workflow columns are defined in YAML configuration
The system SHALL load workflow column definitions from YAML files. Each column definition SHALL include at minimum an `id`, `label`, and optionally an `on_enter_prompt`, `stage_instructions`, and `tools`. The `on_enter_prompt` and `stage_instructions` fields SHALL accept either inline text or a slash reference in the form `/stem [argument]`. The `tools` array SHALL accept built-in group names (`read`, `write`, `search`, `web`, `shell`, `interactions`, `agents`) and individual tool names interchangeably — both resolve to tool definitions.

#### Scenario: Columns load from YAML at startup
- **WHEN** the application starts
- **THEN** workflow templates are read from YAML files and available for board assignment

#### Scenario: Column without on_enter_prompt is valid
- **WHEN** a column is defined in YAML without an `on_enter_prompt`
- **THEN** tasks moved into that column have their `execution_state` set to `idle` and no AI call is made

#### Scenario: Column tools config with group name resolves to all tools in that group
- **WHEN** a column's `tools` array contains a group name (e.g. `write`)
- **THEN** `resolveToolsForColumn` expands it to all tool definitions belonging to that group

#### Scenario: Column tools config with individual name still works
- **WHEN** a column's `tools` array contains an individual tool name (e.g. `read_file`)
- **THEN** `resolveToolsForColumn` includes that specific tool definition as before

#### Scenario: Mixed group and individual names are both resolved
- **WHEN** a column's `tools` array contains both group names and individual tool names
- **THEN** `resolveToolsForColumn` expands groups and includes individual tools, deduplicating if a tool appears in both

#### Scenario: Slash reference in on_enter_prompt is resolved before execution
- **WHEN** a column defines `on_enter_prompt: /opsx-propose add-dark-mode`
- **THEN** the engine resolves the reference to the prompt file body (with `$input` substituted) before constructing the AI request

#### Scenario: Slash reference in stage_instructions is resolved before injection
- **WHEN** a column defines `stage_instructions: /opsx-explore`
- **THEN** the engine resolves the reference and injects the resolved body as the system message for every AI call in that column

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
The system SHALL update a task's `execution_state` based on the structured result returned by or intercepted during AI execution. Valid terminal states are `completed`, `failed`, and `waiting_user`.

#### Scenario: Completed execution updates state to completed
- **WHEN** an execution finishes streaming with a non-empty response and no suspension
- **THEN** the task's `execution_state` is set to `completed`

#### Scenario: Failed execution updates state to failed
- **WHEN** an execution encounters an error or an unrecoverable condition
- **THEN** the task's `execution_state` is set to `failed`

#### Scenario: ask_me tool call transitions to waiting_user
- **WHEN** the AI calls the `ask_me` tool during the tool loop
- **THEN** the engine intercepts the call, appends an `ask_user_prompt` message to the conversation, sets `execution_state = 'waiting_user'`, and exits without streaming a response

#### Scenario: User answer resumes from waiting_user
- **WHEN** a task has `execution_state = 'waiting_user'` and the user sends a message
- **THEN** `handleHumanTurn` runs as normal — the user's answer is appended as a `user` message and the model continues with full conversation context

### Requirement: Frontend is notified immediately on execution state changes
The system SHALL push task state updates to the frontend via IPC whenever execution state changes — including when execution begins and when it completes or fails.

#### Scenario: Running state pushed on human turn
- **WHEN** a user sends a chat message that starts a new execution
- **THEN** a `task.updated` event is sent to the frontend immediately after `execution_state` is set to `running`

#### Scenario: Completed state pushed after stream finishes
- **WHEN** the AI finishes streaming its response and the DB is updated
- **THEN** a `task.updated` event is sent so the board card reflects the final state

### Requirement: run_command executes a shell command in the worktree
The system SHALL execute a shell command in the task's worktree via `run_command`. Before spawning the subprocess, the engine SHALL check the command against the task's shell approval state (see `shell-command-approval` capability). If `shell_auto_approve` is `true` on the task, the check is skipped. If all extracted binaries are in the approved set, the command runs immediately. If any binary is unapproved, execution pauses until the user responds to an approval prompt. On `approve_once` or `approve_all`, the command proceeds. On `deny`, the tool returns a tool error and no subprocess is spawned.

#### Scenario: Approved command runs in worktree
- **WHEN** all binaries in a `run_command` call are in the task's approved set
- **THEN** the command is spawned with `cwd` set to the task's worktree path and its stdout/stderr is returned as the tool result

#### Scenario: Auto-approve bypasses gate
- **WHEN** `shell_auto_approve` is `true` on the task
- **THEN** `run_command` spawns the subprocess immediately without any approval check

#### Scenario: Unapproved binary pauses execution
- **WHEN** a `run_command` call contains a binary not in the approved set and `shell_auto_approve` is `false`
- **THEN** execution is suspended and an approval prompt is issued before any subprocess is spawned

#### Scenario: Denied command returns tool error
- **WHEN** the user denies an approval prompt for a `run_command`
- **THEN** the tool returns an error string and no subprocess is spawned

### Requirement: web tool group provides URL fetch and internet search tools
The system SHALL define a `web` tool group containing `fetch_url` and `search_internet`. The group SHALL be available for use in workflow column `tools` arrays. `fetch_url` SHALL always execute regardless of configuration. `search_internet` SHALL self-disable gracefully when not configured.

#### Scenario: web group resolves to fetch_url and search_internet
- **WHEN** a column's `tools` array contains `"web"`
- **THEN** `resolveToolsForColumn` expands it to `["fetch_url", "search_internet"]`

### Requirement: workspace.yaml supports a search configuration block
The system SHALL support an optional `search` block in `workspace.yaml` with fields `engine` (string) and `api_key` (string). When absent, search-dependent tools SHALL degrade gracefully.

### Requirement: Human turn slash references invoke prompt files mid-conversation
The system SHALL detect when a user's chat message begins with a `/stem` pattern and resolve it as a slash reference using the task's project worktree. The resolved prompt body (with `$input` substituted) SHALL replace the user's raw message text before it is sent to the AI.

#### Scenario: User message starting with slash pattern is resolved
- **WHEN** a user sends `/opsx-sync` in the task chat
- **THEN** the engine resolves `.github/prompts/opsx-sync.prompt.md` from the worktree, strips frontmatter, substitutes `$input`, and uses the resolved body as the user turn content sent to the AI

#### Scenario: User message with slash and argument passes argument as $input
- **WHEN** a user sends `/opsx-explore caching strategy` in the task chat
- **THEN** `$input` inside the resolved prompt body is substituted with `caching strategy`

#### Scenario: Unresolvable slash message returns error to user
- **WHEN** a user sends a message starting with `/stem` and the file is not found
- **THEN** the system returns an error message to the user in the conversation and does NOT forward the message to the AI

#### Scenario: Regular messages are not affected
- **WHEN** a user sends a message that does not begin with a `/stem` pattern
- **THEN** the message is forwarded to the AI unchanged

#### Scenario: Search config loaded from workspace.yaml
- **WHEN** `workspace.yaml` contains a `search` block with engine and api_key
- **THEN** the loaded config exposes `workspace.search.engine` and `workspace.search.api_key`

#### Scenario: Missing search block does not cause startup error
- **WHEN** `workspace.yaml` has no `search` block
- **THEN** the application starts successfully and `workspace.search` is undefined

### Requirement: ask_me suspends execution and prompts the user for input
The system SHALL provide an `ask_me` tool that pauses agent execution and surfaces a question to the human user. The execution SHALL remain in a `waiting_user` state until the user responds. The response SHALL be appended to the conversation and execution SHALL resume.

#### Scenario: ask_me pauses execution and shows prompt
- **WHEN** an agent calls `ask_me` with a question
- **THEN** the execution_state is set to `waiting_user` and the question is surfaced to the user in the chat UI

#### Scenario: User response resumes execution
- **WHEN** the user submits a reply to an `ask_me` prompt
- **THEN** the reply is injected into the conversation and the agent continues executing

### Requirement: Execution supports abort-signal-based cancellation
The engine SHALL maintain an in-memory `Map<executionId, AbortController>`. When a `tasks.cancel` request is received, the controller for the current execution is aborted. The engine catches the abort and transitions the execution to `cancelled` and the task to `waiting_user`.

#### Scenario: AbortController registered at execution start
- **WHEN** a new execution begins (transition or human turn)
- **THEN** an AbortController is registered in the map keyed by `executionId`

#### Scenario: AbortController removed on execution completion
- **WHEN** an execution finishes normally (completed, failed, waiting_user)
- **THEN** the AbortController for that execution is removed from the map

#### Scenario: Abort signal propagated to AI fetch
- **WHEN** `controller.abort()` is called
- **THEN** the in-flight AI HTTP request (streaming or non-streaming) receives the abort signal and terminates early

#### Scenario: Stale running state reset on startup
- **WHEN** the Bun process restarts with tasks in `execution_state = 'running'`
- **THEN** those tasks are reset to `execution_state = 'failed'` (existing restart-recovery behaviour, unchanged)

### Requirement: Tool set offered to model is determined per column
The system SHALL filter `TOOL_DEFINITIONS` to only include tools named in the current column's `tools` configuration before building the AI request. When no `tools` key is present in the column config, the default set (`read_file`, `list_dir`, `run_command`) SHALL be used.

#### Scenario: Column tools list controls what model receives
- **WHEN** an execution runs in a column with `tools: [read_file, ask_me]`
- **THEN** the AI request includes only `read_file` and `ask_me` definitions, regardless of what other tools are registered

#### Scenario: No tools key falls back to defaults
- **WHEN** an execution runs in a column with no `tools` key and a worktree is available
- **THEN** the AI request includes `read_file`, `list_dir`, and `run_command`

#### Scenario: Tool definitions are present on all rounds
- **WHEN** any round of the execution loop runs, including the round that produces the final text response
- **THEN** the `stream()` request includes the full tool definitions, giving the model the option to call additional tools even in the final round

### Requirement: Unified AI stream drives execution from first token to final response
The system SHALL execute all tool rounds and the final text response using a single streaming loop. There SHALL be no separate second API call to retrieve the final answer after tool calls are resolved.

#### Scenario: Tool loop exits after model produces text
- **WHEN** the model returns a streaming response with `finish_reason: "stop"` and no `delta.tool_calls`
- **THEN** the engine treats that streamed text as the final response and does not issue another API call

#### Scenario: Model calls tools then produces final answer
- **WHEN** the model calls one or more tools in sequence and then responds with text
- **THEN** each tool call and result is appended to conversation history and the final text is streamed to the UI in a single continuous session

#### Scenario: Bad assistant responses never enter history
- **WHEN** the model emits tool-call syntax (XML `<tool_call>`, JSON blobs) as plain text in its response
- **THEN** the unified stream() call yields a `tool_calls` event via the API's structured `delta.tool_calls` field; rogue text is never stored as an assistant message

### Requirement: Config singleton supports runtime reload without restart
The system SHALL expose a `reloadConfig()` function that clears the in-memory config singleton and forces a fresh read from disk on the next access. This SHALL be callable at runtime from RPC handlers without restarting the process.

#### Scenario: reloadConfig clears the in-memory singleton
- **WHEN** `reloadConfig()` is called
- **THEN** the internal `_config` singleton is reset to null and the next call to `getConfig()` re-reads all YAML files from disk

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
