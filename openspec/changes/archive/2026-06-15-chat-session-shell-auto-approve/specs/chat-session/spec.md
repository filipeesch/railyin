## ADDED Requirements

### Requirement: Chat session exposes shell auto-approve state
The `ChatSession` type SHALL include `shellAutoApprove: boolean` and `approvedCommands: string[]` fields, mapped from the `chat_sessions` DB columns.

#### Scenario: ChatSession RPC response includes shellAutoApprove
- **WHEN** any RPC endpoint returns a `ChatSession` object
- **THEN** the object includes `shellAutoApprove` reflecting the current DB value

#### Scenario: ChatSession RPC response includes approvedCommands
- **WHEN** any RPC endpoint returns a `ChatSession` object
- **THEN** the object includes `approvedCommands` as a parsed string array

### Requirement: Chat session drawer shows shell auto-approve toggle
The chat session drawer SHALL display a shell auto-approve toggle in the conversation input bar. The toggle SHALL be visually and functionally identical to the task chat toggle. When toggled, the frontend SHALL call `chatSessions.setShellAutoApprove`.

#### Scenario: Toggle visible when chat session is open
- **WHEN** the user opens a chat session drawer
- **THEN** a shell auto-approve toggle is visible in the input bar footer

#### Scenario: Toggle reflects current session state on open
- **WHEN** a chat session with `shellAutoApprove: true` is opened
- **THEN** the toggle is shown in the ON position
