## ADDED Requirements

### Requirement: Orphaned empty assistant messages are filtered before the Anthropic API call
The system SHALL remove assistant messages that have no text content and no tool calls from the adapted message array before transmitting to the Anthropic API. Such messages can appear in `liveMessages` when a streaming round was interrupted before the model emitted any content. The filter SHALL run as a pre-processing pass inside `adaptMessages()`.

#### Scenario: Empty assistant message from interrupted round is removed
- **WHEN** `liveMessages` contains an assistant message whose content is null or whitespace-only and whose `tool_calls` array is absent or empty (the result of an interrupted streaming round)
- **THEN** `adaptMessages()` removes that message before building the Anthropic wire payload and the API call succeeds without a 400 error

#### Scenario: Assistant message with text content is preserved
- **WHEN** an assistant message has non-empty text content
- **THEN** it passes through the orphan filter unchanged and appears in the wire payload

#### Scenario: Assistant message with tool_calls but no text is preserved
- **WHEN** an assistant message has `tool_calls` but null or empty `content`
- **THEN** it passes through the orphan filter unchanged and appears in the wire payload

#### Scenario: Orphan removal is logged for monitoring
- **WHEN** `adaptMessages()` removes an orphaned empty assistant message
- **THEN** a warn-level log entry is emitted containing enough context (e.g. message index) for debugging
