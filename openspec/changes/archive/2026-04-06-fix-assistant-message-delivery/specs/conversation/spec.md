## ADDED Requirements

### Requirement: Final assistant message is delivered via real-time push
The engine SHALL call `onNewMessage` for the final assistant message immediately after persisting it with `appendMessage`, consistent with how all other message types (tool_call, tool_result, reasoning, file_diff, etc.) are delivered. The frontend SHALL NOT rely on a `loadMessages` DB refetch triggered by the `done` streaming signal to receive the final assistant message.

#### Scenario: Assistant message arrives without DB refetch
- **WHEN** the model finishes generating a response and the task drawer is open
- **THEN** the final assistant message appears in the conversation timeline immediately via `onNewMessage`, with no round-trip DB reload after the done signal

#### Scenario: Streaming bubble replaced by persisted message on done
- **WHEN** the engine sends `onNewMessage` for the final assistant message
- **THEN** the frontend clears the streaming bubble and inserts the persisted message in its place, with no visual gap between stream end and message appearance

#### Scenario: Message is available on drawer reopen when delivery was missed
- **WHEN** the task drawer is closed while the model is streaming and reopened after the execution ends
- **THEN** the final assistant message is loaded from the database via `loadMessages`, providing a consistent fallback regardless of whether the live `onNewMessage` push was received
