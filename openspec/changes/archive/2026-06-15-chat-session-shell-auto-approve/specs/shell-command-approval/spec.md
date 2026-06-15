## MODIFIED Requirements

### Requirement: run_command checks each binary against per-task approved set
After extracting binaries, the system SHALL compare the list against the current execution scope's approved set. For tasks, the approved set is `tasks.approved_commands`. For chat sessions, the approved set is `chat_sessions.approved_commands` (looked up via `conversationId`). Binaries present in the approved set SHALL be allowed immediately. Binaries absent from the approved set SHALL be collected and trigger an approval pause.

#### Scenario: All binaries approved — command runs immediately
- **WHEN** the current scope has `["git", "bun"]` in its approved set and the agent calls `run_command` with `bun test && git push`
- **THEN** the command executes without displaying an approval prompt

#### Scenario: One unapproved binary triggers pause
- **WHEN** the current scope has `["git"]` approved and the agent calls `run_command` with `git add . && rm -f temp.txt`
- **THEN** execution pauses and an approval prompt is shown for the binary `["rm"]`

#### Scenario: Multiple unapproved binaries shown together
- **WHEN** the current scope has no approved commands and the agent calls `run_command` with `curl https://example.com | jq .`
- **THEN** a single approval prompt is shown listing all unapproved binaries (`["curl", "jq"]`) in one message

### Requirement: Per-task auto-approve toggle bypasses all approval prompts
The system SHALL support a `shell_auto_approve` boolean field on both tasks and chat sessions. When `true`, all `run_command` calls for that scope SHALL bypass the approval gate entirely and execute immediately without checking the approved set or issuing any prompt. The initial value SHALL be seeded from the owning workspace's `shell_auto_approve` default (if set); otherwise it defaults to `false`.

#### Scenario: Auto-approve enabled skips all prompts
- **WHEN** `shell_auto_approve` is `true` on the current task or chat session and the agent calls `run_command` with any command
- **THEN** the command executes immediately without an approval prompt, regardless of the approved set

#### Scenario: Auto-approve disabled falls back to approval check
- **WHEN** `shell_auto_approve` is `false` (default) on the current task or chat session
- **THEN** every `run_command` call goes through the binary approval gate

#### Scenario: Task created in workspace with auto-approve on starts auto-approving
- **WHEN** the workspace has `shell_auto_approve: true` and a new task is created
- **THEN** the task immediately auto-approves all `run_command` calls without the user needing to toggle the per-task switch

#### Scenario: Chat session created in workspace with auto-approve on starts auto-approving
- **WHEN** the workspace has `shell_auto_approve: true` and a new chat session is created
- **THEN** the chat session immediately auto-approves all `run_command` calls without the user needing to toggle the per-session switch

## REMOVED Requirements

### Requirement: tasks.respondShellApproval RPC endpoint
**Reason**: Replaced by the unified `executions.respondShellApproval` endpoint which works for both task executions and chat session executions without requiring a `taskId` lookup.
**Migration**: Call `executions.respondShellApproval` with `executionId` (embedded in the `shell_approval` message payload) instead. The `executionId` is available in the message content as of this change.
