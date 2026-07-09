## MODIFIED Requirements

### Requirement: Conversation can be compacted into a summary
The system SHALL support compacting a task's conversation history by sending accumulated messages to the AI model and replacing them, for future LLM calls, with a single summary message of type `compaction_summary`. The full history SHALL remain in the conversation's message store (the file-backed `ConversationMessageStore` for new conversations, or the legacy `conversation_messages` table for pre-existing ones). The AI call SHALL use the structured multi-section compaction prompt (see `compaction-prompt` spec) and the stored summary SHALL contain only the `<summary>` block output, with any `<analysis>` scratchpad block stripped prior to storage. Context token estimation for auto-compact threshold checking SHALL reflect the micro-compact decay — i.e., it SHALL estimate tokens for the assembled payload (after inline clearing), not for the raw stored messages. The compaction prompt SHALL explicitly inform the model that a `Session Notes` file exists and is injected separately — allowing the compaction summary to defer persistent facts to the notes layer rather than duplicating them. The compaction-anchor lookup (finding the most recent `compaction_summary` message) SHALL be served by the `ConversationMessageStore`, using the sidecar's `lastCompactionSummaryId`/`lastCompactionSummaryByteOffset` for file-backed conversations rather than scanning the file.

#### Scenario: Compaction appends a summary message
- **WHEN** compaction is triggered (manually or automatically)
- **THEN** a `compaction_summary` message is appended to the conversation containing an AI-generated summary of prior messages, structured according to the compaction prompt template

#### Scenario: Analysis scratchpad is not stored
- **WHEN** compaction completes and the model response contains an `<analysis>` block
- **THEN** the stored `compaction_summary` message contains only the content of the `<summary>` block, not the analysis

#### Scenario: Post-compaction LLM calls use summary, notes, and newer messages
- **WHEN** an LLM call is assembled after a compaction_summary exists in history
- **THEN** the assembled context contains: the system prompt (with session notes block if present), the compaction_summary as a system message, and only messages that occurred after it

#### Scenario: Pre-compaction messages remain retrievable from the message store
- **WHEN** compaction completes
- **THEN** all messages before the compaction_summary are still retrievable via the conversation's `ConversationMessageStore`, whether file-backed or legacy SQLite

#### Scenario: Compaction uses the task's own model
- **WHEN** compaction runs
- **THEN** the AI call for generating the summary uses the same model as the task (`task.model ?? workspace ai.model`)

#### Scenario: Compaction uses stored conversation model
- **WHEN** `compact(taskId, conversationId, workingDirectory)` is called and `conversations.model` is `"pi-local/lmstudio/llama-3.2-3b"`
- **THEN** the Pi session for compaction is created or updated with model `"pi-local/lmstudio/llama-3.2-3b"` and the context window resolved from `model_settings` for that model

#### Scenario: Compaction uses correct context window from model_settings
- **WHEN** `compact()` resolves model `"pi-local/lmstudio/qwen3:8b"` and `model_settings` has `context_window = 32768` for that model
- **THEN** the Pi session used for compaction has `model.contextWindow = 32768`

#### Scenario: Compaction is visible in the conversation UI
- **WHEN** a compaction_summary message exists in the conversation
- **THEN** the UI renders it as a distinct visual divider labelled "— Conversation compacted —" with the summary accessible on expand

#### Scenario: Auto-compact threshold checks assembled token count
- **WHEN** the system checks whether to auto-compact before a send
- **THEN** the token estimate used is based on the assembled payload (after micro-compact clearing), not the raw stored message content

#### Scenario: Compaction-anchor lookup uses sidecar for file-backed conversations
- **WHEN** the system needs to find the most recent `compaction_summary` message for a file-backed conversation
- **THEN** the `ConversationMessageStore` returns it using the sidecar's `lastCompactionSummaryId` rather than scanning the JSONL file
