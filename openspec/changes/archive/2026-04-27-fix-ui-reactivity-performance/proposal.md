## Why

The UI becomes noticeably slow when many tasks are open and multiple conversations are streaming simultaneously. The root cause is a combination of a Vue 3 reactivity misconception that turns every stream event into a global re-render of all visible blocks, plus unbounded memory accumulation across stream states and derived caches that never get cleaned up.

## What Changes

- Remove the global `streamVersion` counter from `conversation.ts` and stop propagating it as a prop through 4 component layers
- Remove all 6 `new Map(streamStates.value)` clone sites — mutate in place (Vue 3 tracks Map mutations natively)
- Remove the `void props.version` hack and `version` prop from `StreamBlockNode.vue`
- Clean up `streamStates` blocks for non-active conversations on execution `done`
- Clean up `contextUsageByConversation` entries when a conversation is deactivated
- Clean up `changedFileCounts` entries when a task is deleted
- Remove passthrough re-exports from `task.ts` and `chat.ts` (8+ computed aliases pointing back to `conversationStore` and `workspaceStore`)
- Replace the `hooks` event bus in `conversation.ts` with direct store dispatch from `App.vue`
- Move `review.ts` local state (`selectedFile`, `filter`, `mode`, `optimisticUpdates`, `reviewVersion`) into `CodeReviewOverlay.vue` as component-local refs
- Convert `launch.ts` from a zero-state Pinia store into a plain API module
- Convert `columnTasks` in `BoardView.vue` from a template function to a computed Map
- Add `v-memo` to `TaskCard` to prevent full-board re-renders when `unreadTaskIds` changes
- Fix `_replaceTask` O(n) board scan — use `task.boardId` for O(1) lookup
- Fix `unreadTaskIds` O(n) Set spread — mutate the reactive Set directly

## Capabilities

### New Capabilities

- `frontend-reactive-stream`: Requirements for how the frontend manages live stream state — Vue 3-idiomatic reactive Map mutations, per-conversation block lifecycle (cleanup on done for non-active conversations), no global version counters.
- `pinia-store-boundaries`: Requirements for what belongs in each Pinia store — no passthrough re-exports, no embedded event buses, store scope rules (local UI state stays in components, cross-component shared state goes in stores).

### Modified Capabilities

*(No existing spec-level behavior changes — all modifications are implementation-internal.)*

## Impact

- **`src/mainview/stores/conversation.ts`** — remove `streamVersion`, remove Map cloning, add cleanup logic, remove hooks system
- **`src/mainview/stores/task.ts`** — remove passthrough re-exports, fix `_replaceTask`, fix `unreadTaskIds`
- **`src/mainview/stores/chat.ts`** — remove passthrough re-exports, fix `unreadSessionIds`
- **`src/mainview/stores/review.ts`** — remove local-only state
- **`src/mainview/stores/launch.ts`** — convert to plain module
- **`src/mainview/components/StreamBlockNode.vue`** — remove `version` prop and `void` hack
- **`src/mainview/components/ConversationPanel.vue`** — remove `streamVersion` prop
- **`src/mainview/components/ConversationBody.vue`** — remove `streamVersion` prop and watch
- **`src/mainview/components/TaskChatView.vue`** — remove `streamVersion` prop, import stores directly
- **`src/mainview/components/SessionChatView.vue`** — remove `streamVersion` prop
- **`src/mainview/components/CodeReviewOverlay.vue`** — absorb local state from `review.ts`
- **`src/mainview/views/BoardView.vue`** — computed columnTasks map, v-memo on TaskCard
- **`src/mainview/App.vue`** — dispatch to task and chat stores directly instead of via hooks
- No backend changes. No API contract changes. No DB migrations.

## Test Coverage

Test suite is tracked separately in the `test-ui-reactivity-performance` change:
- Vitest unit tests for stream block state, O(1) task lookup, reactive Set identity, and dispatch ordering
- Playwright E2E suite (`stream-reactivity.spec.ts`) covering live streaming, rendering isolation via MutationObserver, memory cleanup, unread state, and auto-scroll
