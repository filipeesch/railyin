## ADDED Requirements

### Requirement: Chat sessions persist shell auto-approve state
The system SHALL store `shell_auto_approve` and `approved_commands` on the `chat_sessions` table. A new migration SHALL add `shell_auto_approve INTEGER NOT NULL DEFAULT 0` and `approved_commands TEXT NOT NULL DEFAULT '[]'` columns. The `ChatSession` RPC type SHALL expose `shellAutoApprove: boolean` and `approvedCommands: string[]`.

#### Scenario: New chat session created with workspace auto-approve on
- **WHEN** the workspace has `shell_auto_approve: true` and the user creates a new chat session
- **THEN** the session is created with `shell_auto_approve = 1` in the database

#### Scenario: New chat session created with workspace auto-approve off
- **WHEN** the workspace has `shell_auto_approve: false` (or the field is absent) and the user creates a new chat session
- **THEN** the session is created with `shell_auto_approve = 0` in the database

#### Scenario: Existing sessions default to auto-approve off after migration
- **WHEN** the migration runs on a database containing existing chat sessions
- **THEN** all pre-existing sessions have `shell_auto_approve = 0` (DEFAULT 0, no behaviour change)

### Requirement: Chat sessions support a per-session auto-approve toggle
The system SHALL expose a `chatSessions.setShellAutoApprove` RPC endpoint accepting `{ sessionId: number; enabled: boolean }` that updates `shell_auto_approve` on the `chat_sessions` row and returns the updated `ChatSession`. The chat session drawer SHALL display the toggle identically to the task chat toggle.

#### Scenario: Toggle on persists auto-approve for the session
- **WHEN** the user enables the shell auto-approve toggle in a chat session drawer
- **THEN** `chatSessions.setShellAutoApprove` is called, the DB is updated to `shell_auto_approve = 1`, and the returned `ChatSession` reflects `shellAutoApprove: true`

#### Scenario: Toggle off disables auto-approve for the session
- **WHEN** the user disables the shell auto-approve toggle in a chat session drawer
- **THEN** the DB is updated to `shell_auto_approve = 0` and subsequent commands go through the approval gate

#### Scenario: Toggle visible in chat session drawer
- **WHEN** the user opens a chat session drawer
- **THEN** a shell auto-approve toggle is visible with the same appearance and position as in the task chat input bar

### Requirement: Chat sessions support per-session approved commands
The `approved_commands` column on `chat_sessions` SHALL behave identically to `tasks.approved_commands`. When a user selects "approve all" for a shell command in a chat session, the binary SHALL be appended to the session's `approved_commands` list. Subsequent commands using the same binary SHALL not require approval.

#### Scenario: Approve all persists binary for the chat session
- **WHEN** the user responds "approve all" to a shell approval prompt in a chat session
- **THEN** the approved binary is appended to `chat_sessions.approved_commands` for that session

#### Scenario: Previously approved binary skips prompt
- **WHEN** a binary has been added to a chat session's `approved_commands`
- **THEN** future `run_command` calls using that binary in the same session execute without a prompt

### Requirement: Claude engine respects chat session shell auto-approve
The Claude engine SHALL use a `ShellApprovalScope` discriminated union when looking up and persisting shell approval state. For chat sessions (where `taskId` is null), the scope SHALL be `{ kind: 'chat'; conversationId: number }` and state SHALL be read from and written to `chat_sessions`. When `shellAutoApprove` is `true` for a chat session, all `run_command` calls SHALL execute immediately without prompting.

#### Scenario: Chat session with auto-approve on skips all shell prompts
- **WHEN** a chat session has `shell_auto_approve = 1` and the agent calls `run_command`
- **THEN** the command executes immediately without a shell_approval event being emitted

#### Scenario: Chat session with auto-approve off receives normal approval prompt
- **WHEN** a chat session has `shell_auto_approve = 0` and the agent calls `run_command` with an unapproved binary
- **THEN** a `shell_approval` prompt is emitted and execution pauses waiting for user response

### Requirement: OpenCode engine respects chat session shell auto-approve
The OpenCode engine SHALL check the `ShellApprovalRepository` before pausing on `shell_approval` events. When `shellAutoApprove` is `true` for the current scope, the engine SHALL call `respondPermission(executionId, 'always')` and continue execution without yielding the event.

#### Scenario: OpenCode chat session with auto-approve on skips prompt
- **WHEN** a chat session has `shell_auto_approve = 1` and the OpenCode agent triggers a permission request
- **THEN** the permission is auto-approved and no `shell_approval` event reaches the stream processor

#### Scenario: OpenCode chat session with auto-approve off pauses normally
- **WHEN** a chat session has `shell_auto_approve = 0` and the OpenCode agent triggers a permission request
- **THEN** execution pauses and the user sees a shell_approval prompt as normal

### Requirement: Shell approval response works for chat sessions
The `executions.respondShellApproval` RPC endpoint SHALL accept `{ executionId: number; decision: "approve_once" | "approve_all" | "deny" }` and route the decision to the correct engine for both task executions and chat session executions. The `shell_approval` message payload SHALL include the `executionId` so the frontend can call this endpoint without a separate store lookup.

#### Scenario: Shell approval decision unblocks a paused chat session
- **WHEN** a chat session execution is waiting for shell approval and the user clicks "approve once"
- **THEN** `executions.respondShellApproval` is called with the correct `executionId`, the engine resumes, and the chat session returns to running state

#### Scenario: Shell approval decision unblocks a paused task execution
- **WHEN** a task execution is waiting for shell approval and the user clicks "approve once"
- **THEN** `executions.respondShellApproval` routes the decision identically to the old `tasks.respondShellApproval` behaviour
