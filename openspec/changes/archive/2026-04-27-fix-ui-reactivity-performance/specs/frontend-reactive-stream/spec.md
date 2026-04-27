## ADDED Requirements

### Requirement: Stream state uses in-place Map mutation
The frontend stream state manager SHALL mutate reactive Maps in place using `.set()` and `.delete()` instead of replacing the Map reference. No `new Map(existingMap)` pattern is permitted in stream event handlers.

#### Scenario: Stream event updates a block in place
- **WHEN** a `text_chunk` stream event arrives for an existing block
- **THEN** the block's `content` property is updated directly on the existing Map entry without creating a new Map

#### Scenario: New block is inserted without Map replacement
- **WHEN** any stream event creates a new block
- **THEN** the new block is added via `state.blocks.set(blockId, block)` without reassigning `streamStates.value`

---

### Requirement: No global stream version counter
The frontend SHALL NOT use a global reactive counter to invalidate stream block rendering. Each `StreamBlockNode` component SHALL derive its content solely from its block ID and the reactive block Map.

#### Scenario: Stream event for conversation A does not re-render blocks from conversation B
- **WHEN** a stream event arrives for conversation A while conversation B's blocks are visible
- **THEN** only blocks belonging to conversation A are re-evaluated
- **THEN** blocks belonging to conversation B are NOT re-computed or re-rendered

#### Scenario: Block updates without version prop
- **WHEN** a `StreamBlockNode` component receives updated block content via the reactive Map
- **THEN** the component re-renders based on its `blocks.get(blockId)` dependency only
- **THEN** no `version` prop or `void version` call is present in the component

---

### Requirement: Stream state blocks are cleaned up for non-active conversations
When an execution completes for a conversation that is not currently active, the frontend SHALL clear the block data to prevent unbounded memory growth.

#### Scenario: Done event for background conversation clears blocks
- **WHEN** a `done` stream event arrives
- **AND** the event's `conversationId` does not match the currently active conversation
- **THEN** `state.blocks` is cleared
- **THEN** `state.roots` is set to an empty array
- **THEN** `state.isDone` is set to `true`
- **THEN** `state.executionId` is retained

#### Scenario: Done event for active conversation does not clear blocks
- **WHEN** a `done` stream event arrives
- **AND** the event's `conversationId` matches the currently active conversation
- **THEN** `state.blocks` is NOT cleared (history refresh handles the transition)

---

### Requirement: Context usage is cleaned up on conversation deactivation
The frontend SHALL remove stale context usage entries when a conversation is deactivated to prevent unbounded growth of the `contextUsageByConversation` Map.

#### Scenario: Deactivating a conversation removes its context usage entry
- **WHEN** `setActiveConversation(null)` is called
- **AND** there was a previously active conversation
- **THEN** the previous conversation's entry is deleted from `contextUsageByConversation`

---

### Requirement: Changed file counts are cleaned up on task deletion
The frontend SHALL remove the changed file count entry for a task when that task is deleted.

#### Scenario: Deleting a task removes its changed file count
- **WHEN** a task is deleted
- **THEN** the task's entry in `changedFileCounts` is deleted
