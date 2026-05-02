## Context

Seven production bugs affect the board and task drawer. Several share the same underlying patterns:

1. **Stale DB snapshots** — `transition-executor.ts` captures a task row before finishing all DB writes; returned task carries stale `execution_state`.
2. **Missing JOIN on reads** — `stream-processor.ts` reads `tasks` without joining `task_git_context`; post-execution pushes silently null the `worktreePath` field that controls terminal/code-server button visibility.
3. **Incomplete error teardown** — The `catch` and `error: { fatal: true }` paths in `stream-processor.ts` neither abort the AbortController nor emit a `done` event, leaving the frontend stuck in a live streaming state with a "failed" badge.
4. **No filtering on allowed transitions in drawer** — `TaskChatView.vue` builds its column-select from all board columns instead of the subset permitted by `allowedTransitions`.
5. **Competing scroll commands** — The RAf loop in `ConversationBody.vue` calls both `virtualizer.scrollToIndex` and `scrollToBottom` on every frame, producing opposing position targets that stutter.
6. **IntersectionObserver timing gap** — The sentinel for infinite scroll only fires on _state changes_; if it is already visible when `autoScroll` flips false, no load is triggered.
7. **No autoscroll on reasoning bubble** — `ReasoningBubble.vue` has `overflow-y: auto` but never programmatically scrolls as content grows.

## Goals / Non-Goals

**Goals:**
- Fix all 7 bugs with structural solutions (no workarounds).
- Introduce a `TaskRepository` class as the single source for task+git-context reads, eliminating the scattered bare `SELECT * FROM tasks` pattern.
- Keep all changes backend/frontend local — no schema changes, no new RPC methods.

**Non-Goals:**
- Adding tests (to be tackled separately).
- Refactoring the virtualizer or scroll system beyond the specific RAF loop fix.
- Changing `allowedTransitions` enforcement logic (already correct on drag; only the drawer is affected).

## Decisions

### D1 — `TaskRepository` class, not a standalone function

**Decision**: Extract DB reads into `src/bun/db/task-repository.ts` as a class with a `findById(id): Task | null` method using the full LEFT JOIN on `task_git_context`.

**Alternatives considered**:
- *Module-level helper function* (`task-queries.ts`): simpler, but doesn't express ownership or provide a seam for future expansion (e.g., caching, test injection).
- *Inline the JOIN everywhere*: no centralisation, immediately re-introduces the bug on next consumer.

**Rationale**: A repository class follows the single-responsibility principle and creates a clear injection point. `stream-processor.ts` and `transition-executor.ts` already receive their DB via constructor — `TaskRepository` fits naturally as a constructor param.

### D2 — Re-query after all DB writes in `transition-executor.ts`

**Decision**: Keep `updatedRow` captured at line 61 for `workdirResolver` and `paramsBuilder` (those fields don't change). Add a second read via `TaskRepository.findById` after line 81 (after `execution_state = 'running'` and `current_execution_id` are written) and use that as the return value.

**Alternatives considered**:
- *Move `updatedRow` capture to after line 81*: breaks if `paramsBuilder` or `workdirResolver` ever need fields written by the intermediate INSERT/UPDATE steps.
- *Patch `updatedRow` in memory*: fragile — must be updated whenever new fields are written.

**Rationale**: Two reads are cheap (SQLite, in-process). The second read via `TaskRepository` also benefits from the correct JOIN, eliminating the terminal-button bug for the with-prompt return path.

### D3 — Abort + `done` event in all error paths of `stream-processor.ts`

**Decision**: In both the `catch` block and the `error: { fatal: true }` event handler: call `abortControllers.get(executionId)?.abort()` before cleanup, and emit a `{ type: "done" }` stream event to the frontend.

**Alternatives considered**:
- *Only fix the `catch` block*: the `error: { fatal: true }` path has the same missing abort, confirmed by user.
- *Rely on `finally` for cleanup only*: `finally` already deletes the controller but never calls `.abort()` — the Anthropic SDK's raw broadcast path bypasses `consume()` signal checks.

**Rationale**: Firing `.abort()` stops the SDK HTTP stream. Emitting `done` ensures `streamState.isDone` flips true on the frontend, unlocking the send button. These two operations together bring the error paths to parity with the happy-path teardown.

### D4 — `autoScroll` watcher + `getBoundingClientRect` for infinite scroll sentinel

**Decision**: In `ConversationBody.vue`, watch `autoScroll`. When it transitions `true → false`, check if the sentinel element's `getBoundingClientRect` is within the scroll container's visible bounds. If yes, emit `load-older` immediately.

**Alternatives considered**:
- *Call `observer.observe(sentinel)` again on every `autoScroll` flip*: re-observe would fire only if the intersection state changed since last observe, which is not guaranteed.
- *Poll visibility on a timer*: introduces unnecessary ticks; structural fix is cleaner.

**Rationale**: The root cause is that `IntersectionObserver` fires only on **changes**. The watcher with `getBoundingClientRect` is a one-shot, synchronous visibility check that fires at the exact moment the observer would have missed the event.

### D5 — RAF loop calls only `scrollToBottom` during streaming

**Decision**: During streaming (when the RAF loop is active), call only `scrollToBottom()`. `virtualizer.scrollToIndex` is called exclusively when navigating to a specific message in the non-streaming context.

**Alternatives considered**:
- *Call `scrollToIndex(lastIndex)` and suppress `scrollToBottom`*: virtualizer uses estimated item heights before layout; wrong position on each new message.
- *Debounce the RAF loop*: doesn't fix the root conflict, just makes it less frequent.

**Rationale**: `scrollToBottom()` uses `scrollEl.scrollTop = scrollEl.scrollHeight`, which is always correct. `scrollToIndex` is a virtualizer-level hint that diverges from layout reality during active streaming. The two must not run on the same frame.

## Risks / Trade-offs

- **Two reads per transition (with-prompt path)** — Negligible in SQLite in-process; both are primary-key lookups. [Risk: tiny extra latency] → Acceptable given correctness.
- **`TaskRepository` initial scope is narrow** — Only `findById` is needed now. Future callers may be tempted to add unrelated concerns. [Risk: scope creep] → Enforce SOLID by keeping the class focused on read-side queries for task + related JOIN data.
- **Sentinel visibility check in watcher** — If the scroll container ref is null during the watcher callback (e.g., component unmounting), `getBoundingClientRect` would throw. [Risk: error during unmount] → Guard with `if (!scrollEl.value)` before the check.
- **Abort after fatal error** — If the engine emits `error: { fatal: true }` multiple times (unlikely), calling `.abort()` twice is harmless (already aborted). [Risk: none].
