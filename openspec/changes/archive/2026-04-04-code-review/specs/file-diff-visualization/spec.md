## ADDED Requirements

### Requirement: code_review is a first-class message type
The system SHALL define `"code_review"` as a valid `MessageType` in `rpc-types.ts`. The content of a `code_review` message SHALL be a JSON-serialized `CodeReviewPayload` containing the full set of hunk decisions submitted by the reviewer.

#### Scenario: code_review type is accepted in conversation_messages
- **WHEN** a code review is submitted
- **THEN** a message is stored with `type = "code_review"` and `content` as a JSON-serialized `CodeReviewPayload`

### Requirement: code_review messages are excluded from LLM compaction
The system SHALL exclude `code_review` messages from the message list assembled for LLM API calls. They SHALL NOT appear in `compactMessages` output. Instead, the review's actionable content is injected as a plain-text `"user"` role message to the model.

#### Scenario: code_review not forwarded raw to LLM
- **WHEN** `compactMessages` processes a conversation history containing a `code_review` message
- **THEN** the raw `code_review` row is omitted from the returned array

### Requirement: code_review messages are rendered as a distinct review summary card
The system SHALL render `code_review` messages in the conversation timeline as a collapsible review summary card (not as a plain user message bubble). The card SHALL show the reviewer's decision counts (rejected, change_requested, accepted) and expand to show per-file and per-hunk details.

#### Scenario: code_review renders as a card not a bubble
- **WHEN** a `code_review` message appears in the conversation timeline
- **THEN** a distinct styled card is rendered instead of the standard `MessageBubble`

#### Scenario: Card shows decision summary
- **WHEN** a code_review card is rendered
- **THEN** the collapsed state shows counts of rejected, change_requested, and accepted hunks across all files
