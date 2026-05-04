## Purpose
Defines the shared conversation timeline and input panel used by task chat and standalone session chat.

## Requirements

### Requirement: Shared conversation timeline
The system SHALL provide a `ConversationPanel` component that renders the conversation timeline (user messages, assistant messages, tool use blocks, streaming content) and is usable in both task and session contexts via `entityType: 'task' | 'chat_session'` and `conversationId` props.

#### Scenario: Task context renders task conversation
- **WHEN** `ConversationPanel` is mounted with `entityType: 'task'` and a valid `conversationId`
- **THEN** messages for that conversation are fetched and rendered

#### Scenario: Session context renders session conversation
- **WHEN** `ConversationPanel` is mounted with `entityType: 'chat_session'` and a valid `conversationId`
- **THEN** messages for that conversation are fetched and rendered identically

### Requirement: Message input with send
The system SHALL render a CodeMirror input field within `ConversationPanel`. Pressing Enter (without Shift) SHALL send the message. The send button SHALL be disabled when the input is empty.

#### Scenario: Send on Enter
- **WHEN** the user types text into the input and presses Enter
- **THEN** the message is submitted and a user message bubble appears immediately (optimistic)

#### Scenario: Send button disabled when empty
- **WHEN** the input field is empty
- **THEN** the send button is disabled and Enter does not submit

### Requirement: Streaming assistant response
The system SHALL render streaming AI responses in real time as `stream_events` arrive via WebSocket. A "streaming" visual indicator SHALL be shown while the response is in progress.

#### Scenario: Streaming message renders incrementally
- **WHEN** stream events arrive for an active execution
- **THEN** the assistant message bubble updates incrementally with each new text chunk

#### Scenario: Streaming indicator appears and disappears
- **WHEN** streaming starts
- **THEN** a streaming indicator (e.g., animated cursor) is visible on the bubble
- **WHEN** the execution completes
- **THEN** the streaming indicator is removed

### Requirement: Stop execution button
The system SHALL show a stop button when an execution is actively running. Clicking it SHALL cancel the current execution.

#### Scenario: Stop button visible during execution
- **WHEN** the session or task has a running execution
- **THEN** a stop button is visible in the input area

#### Scenario: Stop button cancels execution
- **WHEN** the user clicks the stop button
- **THEN** the execution is cancelled and the stop button disappears

### Requirement: ask_user and decision_request rendering
The system SHALL render `ask_user` and `decision_request` tool calls inline in the conversation timeline as interactive blocks that accept user input. The `MessageBubble` component and stream processing layer SHALL reference `decision_request` (not `interview_me`) for both event type matching and component rendering. The `MessageType` enum in `rpc-types.ts` SHALL use `"decision_request_prompt"` in place of `"interview_prompt"`.

#### Scenario: ask_user block rendered
- **WHEN** a stream event contains a `tool_use_start` with `toolName: 'ask_user'`
- **THEN** a question block with an input field appears in the conversation timeline

#### Scenario: decision_request block rendered
- **WHEN** a stream event contains a `tool_use_start` with `toolName: 'decision_request'`
- **THEN** the `DecisionRequest` component (formerly `InterviewMe`) is rendered inline in the conversation timeline

#### Scenario: decision_request_prompt message type restored on reload
- **WHEN** a conversation is reloaded after an interrupted execution that was waiting for decision_request input
- **THEN** the persisted `decision_request_prompt` message type is correctly mapped to the `DecisionRequest` interactive block

#### Scenario: User response submitted
- **WHEN** the user fills in the ask_user or decision_request block and submits
- **THEN** the response is sent via the appropriate RPC and execution continues
