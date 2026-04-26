## Purpose
The conversation is the canonical history of task and standalone session chat. It is an append-only log of every message, execution, transition, and tool interaction associated with a conversation.

## Requirements

### Requirement: Conversation is an append-only message timeline
Each task's conversation SHALL be an ordered, append-only sequence of messages. Messages are never deleted or reordered. The conversation serves as the canonical history of everything that happened to the task. The canonical chronology SHALL follow append order, and conversation reads SHALL preserve that order even when multiple messages share the same timestamp.

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

### Requirement: Conversation supports distinct message types
The system SHALL support the following message types in a conversation: `user`, `assistant`, `system`, `tool_call`, `tool_result`, `transition_event`, `file_diff`, `ask_user_prompt`, `reasoning`, `compaction_summary`, `code_review`. Each message stores its type, content, and creation timestamp.

#### Scenario: Transition creates a transition_event message
- **WHEN** a task is moved from one workflow column to another
- **THEN** a `transition_event` message is appended to the conversation recording the from-state and to-state

#### Scenario: Tool calls and results are recorded for all tools including intercepted tools
- **WHEN** the AI makes a tool call during execution, including intercepted tools like `spawn_agent` and `ask_me`
- **THEN** a `tool_call` message is appended before execution, and when the result arrives, a `tool_result` message is appended

#### Scenario: ask_me call creates ask_user_prompt message
- **WHEN** the AI calls the `ask_me` tool
- **THEN** an `ask_user_prompt` message is appended with JSON content containing the structured `questions` array

#### Scenario: Reasoning round creates a reasoning message
- **WHEN** the AI engine receives `reasoning` stream events in a round and that round ends
- **THEN** a single `reasoning` message is appended containing the full accumulated reasoning text for that round

### Requirement: ask_user_prompt message type carries structured question data

The system SHALL store `ask_user_prompt` messages with JSON content conforming to `{ questions: Array<{ question: string, selection_mode: "single" | "multi", options: Array<{ label: string, description?: string, recommended?: boolean, preview?: string }> }> }`. This content drives the interactive widget rendered in the chat pane.

#### Scenario: ask_user_prompt content is valid JSON

- **WHEN** an `ask_user_prompt` message is retrieved from the database
- **THEN** its `content` field parses as JSON with a `questions` array where each item has `question`, `selection_mode`, and `options` (array of objects with at least a `label` field)

#### Scenario: ask_user_prompt content survives reload

- **WHEN** the drawer is closed and reopened while the task is in `waiting_user` state
- **THEN** the `ask_user_prompt` message is loaded from DB and the widget renders correctly from persisted content

### Requirement: Full conversation context is provided to AI on each call
The system SHALL include all prior conversation messages for a task as context when making an AI call, in addition to the current `stage_instructions` and the new prompt or user message. User messages stored with autocomplete chip markup SHALL be converted to derived plain/raw text before they are sent to the engine as either history or the current turn. File and symbol chips SHALL continue to contribute their structured attachment context separately, so the derived text remains clean human text rather than raw chip markup.

#### Scenario: AI receives full history
- **WHEN** an execution is triggered (on_enter_prompt or human turn)
- **THEN** the AI request includes: system message with stage_instructions, all prior conversation messages, and the new message

#### Scenario: Stored chip markup is decoded before AI call
- **WHEN** a prior or current user message contains autocomplete chip markup
- **THEN** the engine receives the derived plain/raw text form of that message, not the literal `[ref|label]` markup

#### Scenario: Stage instructions are always prepended
- **WHEN** any AI call is made for a task
- **THEN** the current column's `stage_instructions` are included as a system message regardless of whether it is a prompt-triggered or human-initiated call

### Requirement: User messages render preserved autocomplete chips as rich chips
The system SHALL render newly stored user messages containing autocomplete chip markup as rich inline chips in the conversation timeline for both task chat and standalone session chat. Rendered user-message chips SHALL preserve their sigil-prefixed visible labels (`/command`, `#file`, `#Symbol`, `@tool`) and SHALL appear inline with surrounding plain text. User messages that do not contain chip markup SHALL continue to render as plain text.

#### Scenario: Sent user message shows slash chip
- **WHEN** a newly sent user message contains stored slash chip markup
- **THEN** the conversation bubble renders an inline chip showing `/command` instead of raw `[ref|label]` text or plain text without the slash

#### Scenario: Sent user message shows file and tool chips
- **WHEN** a newly sent user message contains stored file, symbol, or MCP tool chip markup
- **THEN** the conversation bubble renders inline chips showing the `#` or `@` visible labels in their original message positions

#### Scenario: Older plain-text user message remains plain text
- **WHEN** a previously stored user message contains no chip markup
- **THEN** the conversation bubble renders the message as ordinary user text with no chip parsing requirement

### Requirement: Conversation view renders markdown
The system SHALL render assistant messages as formatted markdown in the task detail view, including headings, lists, code blocks, tables, and blockquotes.

#### Scenario: Assistant response rendered as markdown
- **WHEN** an assistant message is displayed in the conversation timeline
- **THEN** markdown syntax is rendered as formatted HTML (not shown as raw text)

#### Scenario: Live streaming response renders markdown incrementally
- **WHEN** tokens are arriving during an active stream
- **THEN** the streaming bubble renders partial markdown in real time as each token arrives

### Requirement: Streaming state is tracked independently of drawer visibility
The system SHALL continue accumulating stream tokens even when the task detail drawer is closed. The accumulated response SHALL be available immediately when the drawer is re-opened.

#### Scenario: Tokens buffered while drawer is closed
- **WHEN** the user closes the task drawer while the model is streaming a response
- **THEN** tokens continue to accumulate in memory

#### Scenario: Response visible on re-open
- **WHEN** the user re-opens the task drawer for a task that was streaming while closed
- **THEN** all tokens received so far are visible immediately, and new tokens continue to appear

#### Scenario: Full response persisted before done signal
- **WHEN** the model finishes streaming
- **THEN** the complete response is written to the database before the done signal is sent to the frontend, preventing race conditions on re-open

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

### Requirement: Engine flushes one pending message after execution ends
After each execution for a task ends and the task's `execution_state` transitions to `waiting_user` or `idle`, the engine SHALL check the `pending_messages` table for that task. If a pending message exists, the engine SHALL delete the oldest one and call `handleHumanTurn` for that task asynchronously (fire-and-forget). Only one pending message SHALL be flushed per execution end.

#### Scenario: Pending message flushed after execution reaches waiting_user
- **WHEN** an execution ends with `execution_state` becoming `waiting_user` and a pending message exists for that task
- **THEN** the oldest pending message is deleted from `pending_messages` and `handleHumanTurn` is called asynchronously with its content

#### Scenario: Pending message flushed after execution reaches idle
- **WHEN** an execution ends with `execution_state` becoming `idle` and a pending message exists for that task
- **THEN** the oldest pending message is deleted from `pending_messages` and `handleHumanTurn` is called asynchronously with its content

#### Scenario: Only one pending message flushed per execution end
- **WHEN** an execution ends and multiple pending messages exist for the task
- **THEN** only the oldest pending message is flushed; the remaining messages stay in `pending_messages` to be flushed in subsequent executions

#### Scenario: No pending messages leaves state unchanged
- **WHEN** an execution ends and no pending messages exist for the task
- **THEN** no flush occurs and the task remains in its ended execution state

### Requirement: Conversations are not required to have a task
A conversation's association with a task SHALL be optional. `conversations.task_id` SHALL be nullable. A conversation with `task_id = NULL` represents a standalone session conversation.

#### Scenario: Conversation created without task
- **WHEN** a chat session is created
- **THEN** a `conversations` row is inserted with `task_id = NULL` and a valid `conversation_id`

#### Scenario: Existing task conversations unaffected
- **WHEN** a task conversation is accessed
- **THEN** `task_id` is still present and all existing query paths continue to work

### Requirement: Conversation forking metadata
The system SHALL store `parent_conversation_id` and `forked_at_message_id` columns on the `conversations` table to support future conversation branching. Both SHALL default to NULL and have no functional effect in this change.

#### Scenario: Fork columns default to NULL
- **WHEN** a new conversation is created (task or session)
- **THEN** `parent_conversation_id` and `forked_at_message_id` are NULL

### Requirement: stream_events schema uses conversation_id as primary routing key
The `stream_events` table SHALL use `conversation_id` as the primary routing key with a NOT NULL constraint. The `task_id` column SHALL NOT exist in this table. All stream event writes SHALL supply `conversation_id`. Rows with NULL `conversation_id` from pre-migration installs are considered legacy data and SHALL be dropped during the cleanup migration.

The table schema SHALL be:
```
stream_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  execution_id    INTEGER NOT NULL,
  seq             INTEGER NOT NULL,
  block_id        TEXT NOT NULL,
  type            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  metadata        TEXT,
  parent_block_id TEXT,
  subagent_id     TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(conversation_id, seq)
)
```

Indexes:
- `idx_stream_events_conversation (conversation_id, seq)`
- `idx_stream_events_execution (execution_id, seq)`

The `idx_stream_events_task` index SHALL be removed.

#### Scenario: Stream event write requires conversation_id
- **WHEN** code attempts to insert a stream event without a `conversation_id`
- **THEN** the insert fails with a NOT NULL constraint violation

#### Scenario: Stream events queryable by conversation
- **WHEN** `getStreamEventsByConversation(conversationId)` is called
- **THEN** only rows where `conversation_id = conversationId` are returned, ordered by `seq`

#### Scenario: No task_id column exists
- **WHEN** the migration has run on a fresh or upgraded install
- **THEN** `PRAGMA table_info(stream_events)` shows no `task_id` column

### Requirement: Conversation read APIs use conversationId as the canonical identifier
The system SHALL treat `conversationId` as the primary identifier for conversation reads and stream-event reads across both task and standalone session conversations.

#### Scenario: Messages read by conversationId
- **WHEN** a caller requests conversation messages with a `conversationId`
- **THEN** the system returns the ordered messages for that conversation regardless of whether it belongs to a task or a standalone session

#### Scenario: Stream events read by conversationId
- **WHEN** a caller requests persisted stream events with a `conversationId`
- **THEN** the system returns the events for that conversation regardless of whether it belongs to a task or a standalone session

### Requirement: Legacy taskId callers remain compatible during migration
The system SHALL preserve compatibility for task-backed conversation reads during migration by accepting task-based identifiers where required and resolving them to the canonical conversation ID internally.

#### Scenario: Task-backed caller uses compatibility alias
- **WHEN** an existing task-backed caller requests messages or stream events using `taskId`
- **THEN** the system resolves the corresponding `conversationId` internally and returns the canonical conversation data

#### Scenario: Session callers do not require task identity
- **WHEN** a standalone session caller requests messages or stream events
- **THEN** the system uses the session's `conversationId` directly and does not require a task ID

### Requirement: Conversation messages are accessible via paginated API
The system SHALL expose `conversations.getMessages` as a paginated endpoint. The response SHALL be a wrapped object `{ messages: ConversationMessage[], hasMore: boolean }` rather than a flat array. The endpoint SHALL accept optional `beforeMessageId` and `limit` parameters for cursor-based traversal. When called without `beforeMessageId`, it SHALL return the newest `limit` messages. `hasMore` SHALL be `true` when older messages exist beyond the returned page.

#### Scenario: Response is always a wrapped object
- **WHEN** `conversations.getMessages` is called with any parameters
- **THEN** the response is `{ messages: ConversationMessage[], hasMore: boolean }` — never a bare array

#### Scenario: Default call returns newest messages
- **WHEN** `conversations.getMessages` is called with only `conversationId`
- **THEN** the response contains the newest 50 messages in ascending ID order

#### Scenario: Cursor parameter narrows result to older messages
- **WHEN** `conversations.getMessages` is called with `beforeMessageId`
- **THEN** only messages with `id < beforeMessageId` are returned

#### Scenario: Messages within a page are returned in ascending ID order
- **WHEN** a paginated response is returned
- **THEN** `messages` are ordered from oldest to newest (ascending `id`)

### Requirement: Conversation read APIs require conversationId
The system SHALL require `conversationId` for conversation-scoped read APIs. Message reads, persisted stream-event reads, and context-usage reads SHALL use `conversationId` directly and SHALL NOT depend on task-based aliases.

#### Scenario: Messages read with conversationId
- **WHEN** a caller requests conversation messages
- **THEN** the request includes `conversationId`
- **AND** the system returns messages for that conversation in append order

#### Scenario: Persisted stream events read with conversationId
- **WHEN** a caller requests persisted stream events for replay
- **THEN** the request includes `conversationId`
- **AND** the system returns the events for that conversation ordered by `seq`

#### Scenario: Context usage read with conversationId
- **WHEN** a caller requests context usage for a conversation
- **THEN** the request includes `conversationId`
- **AND** the system computes usage for that conversation without requiring a task identifier

### Requirement: All new stream-event writes populate conversation_id
The `stream_events` table SHALL treat `conversation_id` as the canonical conversation lookup key. All new persisted stream-event writes SHALL populate `conversation_id`, including rows emitted for standalone chat sessions where `task_id` is null.

#### Scenario: Task execution persists stream events with conversation_id
- **WHEN** a task execution persists stream events
- **THEN** each persisted row includes the task's `conversation_id`

#### Scenario: Standalone session execution persists stream events with conversation_id
- **WHEN** a standalone chat session persists stream events
- **THEN** each persisted row includes the session's `conversation_id`
- **AND** replay by `conversation_id` can return those rows even when `task_id` is null

### Requirement: Historical stream events are repaired by execution first, task second
When historical `stream_events` rows are missing `conversation_id`, the system SHALL repair them by resolving `execution_id -> executions.conversation_id` first and `task_id -> tasks.conversation_id` second. Rows that remain unrecoverable after both passes MAY be pruned.

#### Scenario: Chat-session rows repaired through executions
- **WHEN** a historical stream-event row belongs to a standalone chat session and lacks `conversation_id`
- **THEN** the repair process resolves the row using `executions.conversation_id`

#### Scenario: Task-backed rows repaired through tasks when execution conversation is absent
- **WHEN** a historical stream-event row belongs to a task and its execution row lacks `conversation_id`
- **THEN** the repair process falls back to the task's `conversation_id`

#### Scenario: Unrecoverable rows may be removed
- **WHEN** a historical stream-event row has no recoverable conversation through either execution or task linkage
- **THEN** the cleanup process may delete that row rather than keep unusable replay state

### Requirement: Task executions persist conversation identity
All new execution rows SHALL persist `conversation_id` for the conversation they belong to, including task-backed executions and standalone session executions.

#### Scenario: Task transition execution stores conversation_id
- **WHEN** a task transition creates an execution row
- **THEN** the inserted execution row includes that task's `conversation_id`

#### Scenario: Task human-turn execution stores conversation_id
- **WHEN** a task human-turn or retry creates an execution row
- **THEN** the inserted execution row includes that task's `conversation_id`

#### Scenario: Session execution stores conversation_id
- **WHEN** a standalone session creates an execution row
- **THEN** the inserted execution row includes the session conversation's `conversation_id`

### Requirement: Standalone sessions render structured streaming conversation state
The system SHALL render standalone session conversations with the same structured streaming tree used in task chat, including reasoning blocks, tool call blocks, tool results, and status updates.

#### Scenario: Session tool call stream renders as grouped blocks
- **WHEN** a standalone session emits structured stream events for tool calls and tool results
- **THEN** the conversation timeline renders grouped tool blocks rather than only raw token text

#### Scenario: Session reasoning stream renders inline
- **WHEN** a standalone session emits reasoning stream events
- **THEN** the conversation timeline renders reasoning content with the same interaction model used in task chat

#### Scenario: Session status chunk renders while execution is active
- **WHEN** a standalone session emits status updates before assistant content is finalized
- **THEN** the shared conversation body shows the streaming status message for that session
