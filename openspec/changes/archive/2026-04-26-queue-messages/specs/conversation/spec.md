## MODIFIED Requirements

### Requirement: Full conversation context is provided to AI on each call
The system SHALL include all prior conversation messages for a task as context when making an AI call, in addition to the current `stage_instructions` and the new prompt or user message. User messages stored with autocomplete chip markup SHALL be converted to derived plain/raw text before they are sent to the engine as either history or the current turn. File and symbol chips SHALL continue to contribute their structured attachment context separately, so the derived text remains clean human text rather than raw chip markup. When queued messages are batched and sent together, the combined message (joined with `"\n\n---\n\n"`) is stored as a single user message in the conversation and treated as one turn of context.

#### Scenario: Messages accumulate across executions
- **WHEN** multiple executions run for the same task
- **THEN** all messages from all executions appear in a single chronological timeline

#### Scenario: Messages cannot be deleted
- **WHEN** a task exists
- **THEN** the system provides no mechanism to delete individual conversation messages

#### Scenario: Messages created in the same second keep append order
- **WHEN** `reasoning`, `tool_call`, `tool_result`, `file_diff`, and `assistant` messages are appended within the same timestamp second
- **THEN** conversation reads return them in the same order they were appended

#### Scenario: Timeline assembly does not reorder neighboring message types
- **WHEN** the frontend groups tool rows or renders live chat items
- **THEN** the visible conversation preserves the same relative order as the underlying append-only message sequence

#### Scenario: Batched queue messages appear as a single user message
- **WHEN** 3 queued messages are auto-sent as one batched send after the assistant turn ends
- **THEN** exactly one `user` message is appended to the conversation containing all three messages joined with separator
