## MODIFIED Requirements

### Requirement: ask_user and interview_me rendering
FROM: ask_user and interview_me rendering
TO: ask_user and decision_request rendering

## MODIFIED Requirements

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
