## Overview

This change finishes the post-chat-console cleanup by making `conversationId` the canonical identifier for conversation-scoped reads and stream replay, while also unifying task and session chat rendering around one visible conversation timeline.

The key design choice is to keep durable history in `conversation_messages` and treat structured stream events as active-execution state. The UI will render one merged timeline composed of paged persisted history plus a synthetic live execution tail while an execution is active.

## Goals

- Remove deprecated `taskId` compatibility from conversation-scoped read APIs once all known callers already use `conversationId`.
- Ensure persisted stream events are keyed and queried by `conversation_id`.
- Make execution rows consistently carry `conversation_id` so historical stream-event recovery is possible.
- Eliminate visible chronology bugs caused by rendering persisted messages and live stream blocks as separate sections.
- Preserve a future-friendly shape for long-chat pagination.

## Non-Goals

- Do not convert genuinely task-owned concepts such as todos, board state, or review overlays away from `taskId`.
- Do not replace `conversation_messages` with `stream_events` as the durable historical transcript.
- Do not implement full infinite scroll in this change; only avoid blocking that future work.

## Current Problems

### Task-shaped compatibility still exists in conversation reads

`conversations.getMessages`, `conversations.getStreamEvents`, and `conversations.contextUsage` still accept `taskId` and resolve it internally. Frontend task callers already know the `conversationId`, so the alias adds ambiguity without providing real value.

### Persisted stream events are not fully conversation-scoped

The schema already includes `stream_events.conversation_id`, but the active write path still persists only `task_id`. This is especially harmful for standalone chat sessions because those rows have `task_id = NULL`, which makes replay by conversation impossible unless `conversation_id` is filled from another source.

### Execution rows do not consistently preserve conversation identity

Chat-session executions already insert `conversation_id`, but several task execution insert paths still do not. That weakens historical recovery because the best repair path for bad stream-event rows is `stream_events.execution_id -> executions.conversation_id`.

### The UI renders two separate timelines

The current shared conversation body renders persisted `conversation_messages` first and structured live stream blocks second. Even when backend event order is correct, the user can still see reasoning, tool calls, and assistant output appear out of chronological order across that rendering boundary.

## Proposed Design

### 1. Make `conversationId` the canonical read identifier

- Remove the `taskId` alias from:
  - `conversations.getMessages`
  - `conversations.getStreamEvents`
  - `conversations.contextUsage`
- Update shared RPC types and frontend callers to pass only `conversationId` for these methods.
- Leave task identity on task-owned APIs unchanged.

This narrows the semantics of conversation APIs: if a read is about a conversation, it is keyed by `conversationId`.

### 2. Make stream-event persistence and replay conversation-scoped

- Extend the stream-event persistence path so each persisted event writes `conversation_id`.
- Keep `task_id` only if still useful for task-centric debugging/reporting, but stop relying on it for conversation replay.
- Query replay by `conversation_id` as the primary path.

#### Historical recovery strategy

When repairing old `stream_events` rows with missing `conversation_id`, use the following precedence:

1. `stream_events.execution_id -> executions.conversation_id`
2. `stream_events.task_id -> tasks.conversation_id`

This order is important because standalone chat-session rows do not have a usable task ID. After both recovery passes, unrecoverable orphan rows can be pruned because `stream_events` is replay/debug state rather than the durable transcript.

### 3. Normalize execution writes

- Update all new task execution inserts to write `executions.conversation_id`.
- Keep chat-session execution inserts as they already do.
- Backfill legacy execution rows where task identity can resolve a conversation.

This makes `executions` a reliable bridge for future replay recovery and debugging.

### 4. Unify the visible timeline

The UI should render one conversation timeline instead of two separate sections.

#### Timeline model

```text
older persisted messages
newer persisted messages
live execution tail (if active)
```

- Persisted history comes from `conversation_messages`
- Active execution structure comes from live `stream.event` state and persisted `stream_events` replay
- While an execution is active, the UI appends one synthetic live tail item to the loaded message history
- When the execution completes and persisted messages are available, the live tail reconciles away

This preserves chronology without requiring the app to page historical `stream_events`.

### 5. Keep the design compatible with future long-chat pagination

This change does not implement infinite scroll, but it intentionally supports that future direction:

- historical pagination can page `conversation_messages`
- cursoring can use `beforeMessageId`
- the live execution tail remains separate from historical paging

That means the future pagination work can safely load older persisted messages without changing the active execution model.

## Data Model Notes

### `tasks.conversation_id`

`tasks.conversation_id` remains nullable because old tasks may still be normalized lazily. Those task rows are still valid and should not be deleted purely for lacking a conversation ID.

### `stream_events`

`stream_events` should be considered recoverable support state:

- useful for replay/reconnect/debugging
- safe to repair from executions/tasks where possible
- safe to prune only when unrecoverable after repair

## Testing Strategy

- Backend handler tests for canonical `conversationId` reads and removal of deprecated `taskId` aliases.
- Backend DB tests for stream-event persistence by `conversation_id` and historical repair/backfill.
- Backend tests for task and chat execution rows writing `conversation_id`.
- UI tests for task chat and session chat chronology with mixed reasoning, tool calls, and assistant output.
- UI tests for replay/reconnect-sensitive scenarios where stream state must reconstruct correctly for standalone sessions.

## Risks and Mitigations

### Risk: removing `taskId` aliases breaks hidden callers

Mitigation: search and update all frontend callers and adjust tests that were explicitly validating the alias as compatibility behavior.

### Risk: live-tail reconciliation duplicates persisted content

Mitigation: treat the live execution tail as execution-scoped transient state and clear or replace it once the persisted message set for that execution is visible.

### Risk: historical repair leaves partial orphan data

Mitigation: perform repair in two passes (execution first, task second) and prune only rows that remain unrecoverable afterward.
