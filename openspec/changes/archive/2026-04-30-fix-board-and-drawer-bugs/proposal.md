## Why

Seven interconnected bugs degrade the core task management experience: cards show wrong status badges after transitions, forbidden column moves appear in the drawer, the terminal/code server buttons vanish after an execution completes, the engine can get stuck in a "failed" state while still streaming, the reasoning bubble and chat messages have broken scroll behavior, and the chat autoscroll stutters during streaming. These issues block daily workflow and erode trust in the board state — they need to be fixed together since several share the same root cause patterns (stale DB snapshots, missing JOIN queries, broken scroll coordination).

## What Changes

- **Fix task badge after transition**: Re-query the DB *after* writing `execution_state = 'running'` in `transition-executor.ts` so the returned `task` has the correct execution state.
- **Filter forbidden transitions in drawer select**: Filter the columns list in `TaskChatView.vue` by `sourceCol.allowedTransitions` so only valid target columns are shown.
- **Preserve worktree fields after execution**: Extract a `TaskRepository` class with a `findById` method that JOINs `task_git_context`; use it in `stream-processor.ts` `finally` and `task_updated` event handler, replacing the bare `SELECT * FROM tasks` query that drops `worktree_path`.
- **Fix false failure / stream keeps going**: In `stream-processor.ts`, call `.abort()` on the AbortController before deleting it, and emit a `done` stream event, in both the `catch` block and the `error: { fatal: true }` event path.
- **Autoscroll reasoning bubble**: Add scroll-to-bottom logic to `ReasoningBubble.vue` whenever content grows while the bubble is streaming.
- **Fix infinite scroll sentinel**: Structurally fix the IntersectionObserver — when `autoScroll` transitions from `true → false`, check if the sentinel is already in the viewport via `getBoundingClientRect` and emit `load-older` immediately if so.
- **Fix autoscroll stutter**: During streaming, the RAF loop should call only `scrollToBottom()`; reserve `virtualizer.scrollToIndex` for non-streaming navigation jumps.

## Capabilities

### New Capabilities

- `task-execution-state-sync`: Ensures the task object returned from a transition always reflects the final DB state (execution_state, current_execution_id) written during that transition — no stale snapshots.
- `task-repository`: A `TaskRepository` class that centralises all task DB reads with the correct JOIN on `task_git_context`, replacing ad-hoc bare queries scattered across the engine layer.

### Modified Capabilities

- `column-allowed-transitions`: The drawer's column-select must filter to only transitions permitted by the source column's `allowedTransitions` list, consistent with the board's drag enforcement.
- `stream-processor-lifecycle`: The error and fatal-event paths must abort the active signal and emit a `done` event so the frontend converges to a terminal state, matching the behaviour already specified for the happy path.
- `terminal-session-pane`: The terminal and code-server launch buttons must remain visible after an execution completes; worktree fields must not be nulled out by a post-execution DB snapshot that lacks the git-context JOIN.
- `conversation`: Chat autoscroll must not stutter during streaming; the infinite scroll sentinel must trigger correctly when the user scrolls up mid-stream; the reasoning bubble must scroll to the latest content while streaming.

## Impact

- **Backend**: `src/bun/engine/execution/transition-executor.ts`, `src/bun/engine/stream/stream-processor.ts`; new `src/bun/db/task-repository.ts`; `src/bun/handlers/tasks.ts` (consume `TaskRepository`).
- **Frontend**: `src/mainview/components/TaskChatView.vue` (transition filter), `src/mainview/components/ConversationBody.vue` (scroll fixes), `src/mainview/components/ReasoningBubble.vue` (scroll fix).
- **Shared types**: No changes to `rpc-types.ts` — all fixes are implementation-only.
- **No breaking API changes.**
