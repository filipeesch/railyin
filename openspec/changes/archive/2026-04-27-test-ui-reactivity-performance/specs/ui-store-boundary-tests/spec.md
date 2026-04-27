## ADDED Requirements

### Requirement: Task lookup uses O(1) boardId path
`_replaceTask` in `task.ts` SHALL use `task.boardId` to directly access `tasksByBoard[task.boardId]` instead of scanning all boards linearly.

#### Scenario: Updated task is replaced in the correct board by boardId
- **WHEN** `onTaskUpdated` is called with a task whose boardId matches a loaded board
- **THEN** `tasksByBoard[boardId][index]` is the updated task object
- **AND** `taskIndex[task.id]` is the updated task object

#### Scenario: Task in wrong board is not affected
- **WHEN** `onTaskUpdated` is called for a task on board 1
- **THEN** `tasksByBoard[board2]` is unchanged

### Requirement: Unread task IDs use reactive Set mutation
`unreadTaskIds` in `task.ts` SHALL be updated via `.add()` / `.delete()` on the existing reactive Set, not by creating a new Set via spread.

#### Scenario: markTaskUnread adds to Set without creating new instance
- **WHEN** `markTaskUnread(taskId)` is called
- **THEN** `taskStore.unreadTaskIds` is the same Set instance as before the call
- **AND** the taskId is present in the Set

#### Scenario: clearTaskUnread removes from Set without creating new instance
- **WHEN** `clearTaskUnread(taskId)` is called after `markTaskUnread(taskId)`
- **THEN** `taskStore.unreadTaskIds` is the same Set instance as before the call
- **AND** the taskId is NOT present in the Set

### Requirement: Unread session IDs use reactive Set mutation
`unreadSessionIds` in `chat.ts` SHALL be updated via `.add()` / `.delete()` on the existing reactive Set.

#### Scenario: markUnread adds to Set without creating new instance
- **WHEN** `chatStore.markUnread(sessionId)` is called
- **THEN** `chatStore.unreadSessionIds` is the same Set instance as before the call
- **AND** the sessionId is present in the Set

### Requirement: Multi-store dispatch order is conversation-first
When `App.vue` dispatches a stream event, `conversationStore.onStreamEvent` SHALL be called before `taskStore.onTaskStreamEvent` and `chatStore.onChatStreamEvent`, so downstream stores read already-updated stream state.

#### Scenario: Task store sees updated stream state when reacting to event
- **WHEN** the dispatch sequence runs for a stream event belonging to the active task
- **THEN** `conversationStore.streamStates` already contains the event's data when `onTaskStreamEvent` executes

#### Scenario: All three stores receive every stream event
- **WHEN** a stream event is dispatched via `App.vue`
- **THEN** all three stores (conversation, task, chat) receive the event in the correct order

### Requirement: `changedFileCounts` is cleaned up on task deletion
When a task is deleted, its entry in `changedFileCounts` SHALL be removed to prevent unbounded memory growth.

#### Scenario: Deleted task has no changedFileCounts entry
- **WHEN** `deleteTask(taskId)` completes successfully
- **THEN** `taskStore.changedFileCounts[taskId]` is undefined
