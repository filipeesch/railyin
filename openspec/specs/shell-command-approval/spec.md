## Purpose
The shell command approval capability provides a consent-based security gate for `run_command` calls. Instead of a static blocklist, each task maintains a per-task set of approved command binaries. The user is prompted to approve, deny, or auto-approve before any unapproved binary is executed.

## Requirements

### Requirement: run_command extracts command binaries before execution
Before executing any `run_command` call, the system SHALL parse the full command string to extract a deduplicated list of command binaries. Extraction SHALL split the command on shell meta-characters (`&&`, `||`, `;`, and `|`). Pipe characters (`|`) SHALL be treated as command boundaries — every segment of a pipeline, including receivers, requires approval. The extraction function SHALL be engine-agnostic and located in `engine/approved-commands.ts` as `parseShellBinaries`, available to all engines. The resulting list is passed to the approval gate.

#### Scenario: Single command binary extracted
- **WHEN** the agent calls `run_command` with `git status`
- **THEN** the extracted binary list is `["git"]`

#### Scenario: Compound command binaries extracted
- **WHEN** the agent calls `run_command` with `cd src && bun test && git diff`
- **THEN** the extracted binary list is `["cd", "bun", "git"]`

#### Scenario: Duplicate binaries deduplicated
- **WHEN** the agent calls `run_command` with `git add . && git commit -m "msg"`
- **THEN** the extracted binary list is `["git"]` (deduplicated)

#### Scenario: Pipe receiver IS extracted and requires approval
- **WHEN** the agent calls `run_command` with `bun test | cat`
- **THEN** the extracted binary list is `["bun", "cat"]` — `cat` is a pipe receiver and SHALL require approval

#### Scenario: Multiple pipe receivers are all extracted
- **WHEN** the agent calls `run_command` with `ls -la | grep ts | wc -l`
- **THEN** the extracted binary list is `["ls", "grep", "wc"]`

#### Scenario: Mixed shell meta-characters all split correctly
- **WHEN** the agent calls `run_command` with `git status && bun test | cat`
- **THEN** the extracted binary list is `["git", "bun", "cat"]`

### Requirement: run_command checks each binary against per-task approved set
After extracting binaries, the system SHALL compare the list against the task's current approved set (union of `tasks.approved_commands` from the DB and in-memory approve_once state). Binaries present in the approved set SHALL be allowed immediately. Binaries absent from the approved set SHALL be collected and trigger an approval pause.

#### Scenario: All binaries approved — command runs immediately
- **WHEN** a task has `["git", "bun"]` in its approved set and the agent calls `run_command` with `bun test && git push`
- **THEN** the command executes without displaying an approval prompt

#### Scenario: One unapproved binary triggers pause
- **WHEN** a task has `["git"]` approved and the agent calls `run_command` with `git add . && rm -f temp.txt`
- **THEN** execution pauses and an approval prompt is shown for the binary `["rm"]`

#### Scenario: Multiple unapproved binaries shown together
- **WHEN** a task has no approved commands and the agent calls `run_command` with `curl https://example.com | jq .`
- **THEN** a single approval prompt is shown listing all unapproved binaries (`["curl", "jq"]`) in one message

### Requirement: Approval pause shows full command and unapproved binaries
When unapproved binaries are detected, the system SHALL write a message of type `ask_user_prompt` with `subtype: "shell_approval"` to the conversation. The payload SHALL include the full raw command string and the list of unapproved binary names. Execution SHALL be suspended by setting `execution_state = 'waiting_user'` and emitting a `task.updated` event.

#### Scenario: Approval message written to conversation
- **WHEN** approval is required for a `run_command` call
- **THEN** a message with `type = "ask_user_prompt"` and `subtype = "shell_approval"` appears in the task conversation timeline

#### Scenario: Full command visible in approval prompt
- **WHEN** the approval prompt is displayed
- **THEN** the full raw command string passed to `run_command` is included in the prompt payload

#### Scenario: Task pauses during approval
- **WHEN** an approval prompt is issued
- **THEN** `execution_state` is set to `waiting_user` and a `task.updated` event is emitted

### Requirement: User can approve a command binary once
The system SHALL support an `approve_once` response to an approval prompt. When selected, the approved binaries SHALL be held in memory only for the duration of the current tool call. No DB write occurs. The `run_command` proceeds immediately after the response.

#### Scenario: Approve once allows current command to run
- **WHEN** the user selects "Approve once" on an approval prompt for binary `["rm"]`
- **THEN** the pending `run_command` executes and `["rm"]` is NOT written to `tasks.approved_commands`

#### Scenario: Approve once does not persist across subsequent run_command calls
- **WHEN** the user approved `["curl"]` once during a prior `run_command` call
- **THEN** the next `run_command` call with `curl` triggers a new approval prompt

### Requirement: User can approve command binaries for the task lifetime
The system SHALL support an `approve_all` response to an approval prompt. When selected, the unapproved binaries SHALL be appended to `tasks.approved_commands` in the database and merged into the in-memory approved set. Subsequent `run_command` calls in the same task SHALL not prompt for those binaries again.

#### Scenario: Approve for task writes to DB
- **WHEN** the user selects "Approve for task" on an approval prompt for binaries `["rm", "curl"]`
- **THEN** `"rm"` and `"curl"` are appended to the `tasks.approved_commands` JSON array in the DB

#### Scenario: Approve for task persists across executions
- **WHEN** a task already has `["git"]` in `approved_commands` and a new execution starts
- **THEN** `run_command` calls with `git` run without prompting

#### Scenario: Approve for task does not reset on column change
- **WHEN** a task moves to a new workflow column
- **THEN** `approved_commands` retains all previously approved binaries

### Requirement: User can deny a run_command approval prompt
The system SHALL support a `deny` response to an approval prompt. When selected, the engine SHALL return a tool error string to the agent indicating the command was denied. The AI execution SHALL continue; the agent decides how to proceed given the error.

#### Scenario: Deny returns tool error to agent
- **WHEN** the user selects "Deny" on an approval prompt
- **THEN** the `run_command` tool returns an error string such as `"Command denied by user"` and the agent continues its turn

#### Scenario: Denied command does not execute
- **WHEN** the user denies a `run_command`
- **THEN** no subprocess is spawned and no output is produced

### Requirement: Per-task auto-approve toggle bypasses all approval prompts
The system SHALL support a per-task `shell_auto_approve` boolean field. When `true`, all `run_command` calls SHALL bypass the approval gate entirely and execute immediately without checking the approved set or issuing any prompt.

#### Scenario: Auto-approve enabled skips all prompts
- **WHEN** `shell_auto_approve` is `true` on a task and the agent calls `run_command` with any command
- **THEN** the command executes immediately without an approval prompt, regardless of the approved set

#### Scenario: Auto-approve disabled falls back to approval check
- **WHEN** `shell_auto_approve` is `false` (default) on a task
- **THEN** every `run_command` call goes through the binary approval gate
