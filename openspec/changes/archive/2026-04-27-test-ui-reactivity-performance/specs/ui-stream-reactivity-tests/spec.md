## ADDED Requirements

### Requirement: Stream block Map identity is preserved on mutation
The `streamStates` Map in `conversation.ts` SHALL NOT be replaced with a new Map instance when a stream event is processed. Vue 3 tracks `Map.set()` per-key natively and no clone is required.

#### Scenario: First chunk creates entry without cloning Map
- **WHEN** `onStreamEvent` is called with the first chunk for a conversation
- **THEN** `store.streamStates.value` is the same Map instance as before the call (identity preserved)

#### Scenario: Second chunk mutates entry without cloning Map
- **WHEN** `onStreamEvent` is called with a subsequent chunk for an already-tracked conversation
- **THEN** `store.streamStates.value` is the same Map instance as before the call

#### Scenario: Text chunk appends to existing block
- **WHEN** `onStreamEvent` is called with a `text_chunk` event for an active block
- **THEN** the block's `text` field contains the concatenation of all previously received text and the new chunk

#### Scenario: New block is registered on tool_start
- **WHEN** `onStreamEvent` is called with a `tool_start` event
- **THEN** a new block entry exists in the conversation's stream state with the correct `blockId` and `toolName`

#### Scenario: Stream state is cleaned up on done for non-active conversation
- **WHEN** `onStreamEvent` is called with a `done` event for a conversation that is NOT the active conversation
- **THEN** the conversation's `blocks` Map is empty and `roots` array is empty
- **AND** `isDone` is `true` on the state shell

#### Scenario: Stream state shell is retained on done for non-active conversation
- **WHEN** `onStreamEvent` is called with a `done` event for a non-active conversation
- **THEN** `store.streamStates.value.get(conversationId)` is not undefined (shell retained)
- **AND** `executionId` is still present on the shell

#### Scenario: Active conversation blocks are NOT cleared on done
- **WHEN** `onStreamEvent` is called with a `done` event for the currently active conversation
- **THEN** the conversation's `blocks` Map still contains all streamed blocks

### Requirement: Rendering isolation — background stream events do not mutate active conversation DOM
The frontend SHALL NOT trigger DOM mutations on the active conversation's element tree when stream events arrive for a different (background) conversation.

#### Scenario: Background stream events produce zero DOM mutations on active conversation
- **WHEN** a drawer is open for task A and 5 stream events are pushed for task B
- **THEN** a MutationObserver attached to task A's `.conv-body` records zero mutations
- **AND** task B's task card shows an unread indicator dot

### Requirement: Auto-scroll tracks stream content without streamVersion prop
The conversation body SHALL auto-scroll to the bottom when new stream blocks are added, using `roots.length` as the scroll trigger rather than a `streamVersion` prop.

#### Scenario: Scroll triggers on new root block appearance
- **WHEN** a stream event adds a new root block to the active conversation
- **THEN** the conversation body scrolls to the bottom within 500ms

#### Scenario: Scroll does not fire for background conversation events
- **WHEN** stream events arrive for a non-active conversation
- **THEN** the active conversation's scroll position does not change
