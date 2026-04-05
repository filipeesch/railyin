## MODIFIED Requirements

### Requirement: Conversation can be compacted into a summary
The system SHALL support compacting a task's conversation history by sending accumulated messages to the AI model and replacing them, for future LLM calls, with a single summary message of type `compaction_summary`. The full history SHALL remain in the database. The compaction prompt SHALL explicitly inform the model that a `Session Notes` file exists and is injected separately — allowing the compaction summary to defer persistent facts to the notes layer rather than duplicating them.

#### Scenario: Compaction appends a summary message
- **WHEN** compaction is triggered (manually or automatically)
- **THEN** a `compaction_summary` message is appended to the conversation containing an AI-generated summary of prior messages

#### Scenario: Post-compaction LLM calls use summary, notes, and newer messages
- **WHEN** an LLM call is assembled after a compaction_summary exists in history
- **THEN** the assembled context contains: the system prompt (with session notes block if present), the compaction_summary as a system message, and only messages that occurred after it
