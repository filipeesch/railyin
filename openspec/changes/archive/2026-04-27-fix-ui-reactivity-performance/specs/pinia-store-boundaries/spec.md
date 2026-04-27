## ADDED Requirements

### Requirement: Stores do not re-export passthrough computed aliases
A Pinia store SHALL NOT expose computed properties that are simple aliases to another store's state (e.g., `const messages = computed(() => otherStore.messages)`). Components that need state from multiple stores SHALL import those stores directly.

#### Scenario: Component accesses conversation state directly
- **WHEN** a component needs conversation messages or stream state
- **THEN** it imports `useConversationStore` directly
- **THEN** it does NOT read `taskStore.messages` or `chatStore.messages` as aliases

#### Scenario: Component accesses model list directly
- **WHEN** a component needs the available models list
- **THEN** it imports `useWorkspaceStore` directly
- **THEN** it does NOT read `taskStore.availableModels` as an alias

---

### Requirement: Stream event dispatch is explicit at the application boundary
The application root SHALL dispatch stream events explicitly to each store that needs them. Stores SHALL NOT use an embedded event bus (hook registration pattern) to intercept events from another store.

#### Scenario: App.vue dispatches to all relevant stores
- **WHEN** a `stream.event` WebSocket push arrives
- **THEN** `App.vue` calls `conversationStore.onStreamEvent(event)` directly
- **THEN** `App.vue` calls `taskStore.handleStreamEvent(event)` directly
- **THEN** `App.vue` calls `chatStore.handleStreamEvent(event)` directly
- **THEN** no `registerHooks` or hook-iteration occurs inside any store

---

### Requirement: UI-only overlay state is component-local
State that is read and written exclusively by a single component SHALL be declared as component-local `ref`s, not stored in a Pinia store.

#### Scenario: Code review overlay state is component-local
- **WHEN** the code review overlay is open
- **THEN** `selectedFile`, `filter`, `mode`, `optimisticUpdates`, and `reviewVersion` are managed as local refs inside `CodeReviewOverlay.vue`
- **THEN** `useReviewStore` exposes only `isOpen`, `taskId`, and `files`

---

### Requirement: Zero-state stores are replaced by plain modules
A Pinia store that holds no reactive state SHALL be converted to a plain ES module.

#### Scenario: Launch functions are a plain module
- **WHEN** a component needs to launch a process or get a launch config
- **THEN** it imports functions from a plain module (not a Pinia store)
- **THEN** no `useLaunchStore()` call exists in the codebase

---

### Requirement: Board column task grouping is computed once per render
The board view SHALL compute task groupings by column using a cached `computed` value, not a template function called per column.

#### Scenario: Column task list is derived from a computed Map
- **WHEN** the board renders its columns
- **THEN** task grouping by `workflowState` is computed once per reactive change
- **THEN** each column reads from the cached Map rather than re-filtering the full task list

---

### Requirement: Task cards use v-memo to prevent unnecessary re-renders
Task card components SHALL use `v-memo` bound to the properties they actually display, preventing re-renders when unrelated store state changes.

#### Scenario: Unread status change for task A does not re-render task B's card
- **WHEN** `unreadTaskIds` is updated for task A
- **THEN** the `TaskCard` component for task B is NOT re-rendered
- **THEN** only task A's card is updated

---

### Requirement: Unread ID collections use native reactive mutation
`unreadTaskIds` and `unreadSessionIds` SHALL be mutated using `.add()` and `.delete()` on the reactive Set directly, not by creating a new Set with spread.

#### Scenario: Marking a task unread does not recreate the Set
- **WHEN** `markTaskUnread(taskId)` is called
- **THEN** `unreadTaskIds.value.add(taskId)` is called
- **THEN** `unreadTaskIds.value` is NOT reassigned to a new Set
