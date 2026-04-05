## ADDED Requirements

### Requirement: AI provider wire payloads guarantee no consecutive same-role messages
The system SHALL merge consecutive messages with the same role into a single message before transmitting to any provider. This normalization SHALL run at the provider boundary — as a post-processing pass inside `adaptMessages()` for the Anthropic provider and as a pre-processing pass in `stream()` and `turn()` for the OpenAI-compatible provider. The engine and `assembleMessages()` SHALL remain provider-agnostic; any provider-specific merging guard in the engine SHALL be removed once this requirement is satisfied.

#### Scenario: Consecutive user messages merged in Anthropic payload
- **WHEN** `adaptMessages()` produces two consecutive `role: "user"` entries (e.g. a tool result followed by a text prompt injected by the engine)
- **THEN** they are merged into a single entry whose content concatenates the two with `"\n\n"` as separator

#### Scenario: Consecutive user messages merged in OpenAI-compatible payload
- **WHEN** the OpenAI-compatible provider's normalization pass finds two consecutive `role: "user"` messages
- **THEN** they are merged into one message with concatenated content

#### Scenario: Consecutive assistant messages merged
- **WHEN** two consecutive assistant messages appear in the adapted array
- **THEN** their text content is concatenated and their `tool_calls` arrays are combined in order into a single assistant message

#### Scenario: Run of three or more consecutive same-role messages merged into one
- **WHEN** three or more consecutive messages share the same role
- **THEN** all are merged into a single message as if the pairwise merge were applied repeatedly

#### Scenario: Correctly alternating messages are unaffected
- **WHEN** user and assistant messages alternate with no consecutive same-role entries
- **THEN** the normalization pass returns the array unchanged
