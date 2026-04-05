## MODIFIED Requirements

### Requirement: Conversation can be compacted into a summary
The system SHALL support compacting a task's conversation history by sending accumulated messages to the AI model and replacing them, for future LLM calls, with a single summary message of type `compaction_summary`. The full history SHALL remain in the database. Context token estimation for auto-compact threshold checking SHALL reflect the micro-compact decay — i.e., it SHALL estimate tokens for the assembled payload (after inline clearing), not for the raw stored messages.

#### Scenario: Compaction appends a summary message
- **WHEN** compaction is triggered (manually or automatically)
- **THEN** a `compaction_summary` message is appended to the conversation containing an AI-generated summary of prior messages

#### Scenario: Post-compaction LLM calls use only summary and newer messages
- **WHEN** an LLM call is assembled after a compaction_summary exists in history
- **THEN** the assembled context contains the compaction_summary as a system message plus only messages that occurred after it — not the full prior history

#### Scenario: Auto-compact threshold checks assembled token count
- **WHEN** the system checks whether to auto-compact before a send
- **THEN** the token estimate used is based on the assembled payload (after micro-compact clearing), not the raw stored message content
