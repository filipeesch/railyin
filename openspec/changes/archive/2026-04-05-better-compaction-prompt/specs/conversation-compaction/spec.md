## MODIFIED Requirements

### Requirement: Conversation can be compacted into a summary
The system SHALL support compacting a task's conversation history by sending accumulated messages to the AI model and replacing them, for future LLM calls, with a single summary message of type `compaction_summary`. The full history SHALL remain in the database. The AI call SHALL use the structured multi-section compaction prompt (see `compaction-prompt` spec) and the stored summary SHALL contain only the `<summary>` block output, with any `<analysis>` scratchpad block stripped prior to storage.

#### Scenario: Compaction appends a summary message
- **WHEN** compaction is triggered (manually or automatically)
- **THEN** a `compaction_summary` message is appended to the conversation containing an AI-generated summary of prior messages, structured according to the compaction prompt template

#### Scenario: Post-compaction LLM calls use only summary and newer messages
- **WHEN** an LLM call is assembled after a compaction_summary exists in history
- **THEN** the assembled context contains the compaction_summary as a system message plus only messages that occurred after it — not the full prior history

#### Scenario: Analysis scratchpad is not stored
- **WHEN** compaction completes and the model response contains an `<analysis>` block
- **THEN** the stored `compaction_summary` message contains only the content of the `<summary>` block, not the analysis
