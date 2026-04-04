## ADDED Requirements

### Requirement: Conversation can be compacted into a summary
The system SHALL support compacting a task's conversation history by sending accumulated messages to the AI model and replacing them, for future LLM calls, with a single summary message of type `compaction_summary`. The full history SHALL remain in the database.

#### Scenario: Compaction appends a summary message
- **WHEN** compaction is triggered (manually or automatically)
- **THEN** a `compaction_summary` message is appended to the conversation containing an AI-generated summary of prior messages

#### Scenario: Post-compaction LLM calls use only summary and newer messages
- **WHEN** an LLM call is assembled after a compaction_summary exists in history
- **THEN** the assembled context contains the compaction_summary as a system message plus only messages that occurred after it — not the full prior history

#### Scenario: Pre-compaction messages remain in database
- **WHEN** compaction completes
- **THEN** all messages before the compaction_summary are still retrievable from the database

#### Scenario: Compaction uses the task's own model
- **WHEN** compaction runs
- **THEN** the AI call for generating the summary uses the same model as the task (`task.model ?? workspace ai.model`)

#### Scenario: Compaction is visible in the conversation UI
- **WHEN** a compaction_summary message exists in the conversation
- **THEN** the UI renders it as a distinct visual divider labelled "— Conversation compacted —" with the summary accessible on expand

### Requirement: User can manually trigger compaction at any time
The system SHALL expose a `tasks.compact` RPC and a "Compact" button in the task detail drawer that allows the user to trigger compaction at any time regardless of current context usage.

#### Scenario: Manual compact button visible in drawer
- **WHEN** the task detail drawer is open and the task is not currently running
- **THEN** a "Compact" button is visible

#### Scenario: Manual compact RPC stores summary
- **WHEN** `tasks.compact` is called for a task
- **THEN** a compaction AI call is made and the resulting summary is stored as a `compaction_summary` message

#### Scenario: Compact button disabled while running
- **WHEN** the task execution state is `running`
- **THEN** the Compact button is disabled

### Requirement: Compaction auto-triggers when context usage reaches 90%
The system SHALL automatically compact the conversation before sending a user message if the estimated context usage is at or above 90% of the model's context window.

#### Scenario: Auto-compact fires before send at threshold
- **WHEN** the user sends a message and estimated context usage is ≥ 90%
- **THEN** compaction runs first, a compaction_summary is appended, and the user message is sent afterward

#### Scenario: Auto-compact does not fire below threshold
- **WHEN** the user sends a message and estimated context usage is below 90%
- **THEN** no compaction occurs and the message is sent normally

#### Scenario: Compacting indicator shown during auto-compact
- **WHEN** auto-compact is running before a send
- **THEN** a "Compacting conversation…" status message is shown in the conversation timeline
