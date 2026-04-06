## Purpose
The conversation is the canonical history of a task. It is an append-only log of every message, execution, transition, and tool interaction associated with that task.

## Requirements

### Requirement: Conversation is an append-only message timeline
Each task's conversation SHALL be an ordered, append-only sequence of messages. Messages are never deleted or reordered. The conversation serves as the canonical history of everything that happened to the task.

#### Scenario: Messages accumulate across executions
- **WHEN** multiple executions run for the same task
- **THEN** all messages from all executions appear in a single chronological timeline

#### Scenario: Messages cannot be deleted
- **WHEN** a task exists
- **THEN** the system provides no mechanism to delete individual conversation messages

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
The system SHALL include all prior conversation messages for a task as context when making an AI call, in addition to the current `stage_instructions` and the new prompt or user message.

#### Scenario: AI receives full history
- **WHEN** an execution is triggered (on_enter_prompt or human turn)
- **THEN** the AI request includes: system message with stage_instructions, all prior conversation messages, and the new message

#### Scenario: Stage instructions are always prepended
- **WHEN** any AI call is made for a task
- **THEN** the current column's `stage_instructions` are included as a system message regardless of whether it is a prompt-triggered or human-initiated call

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
