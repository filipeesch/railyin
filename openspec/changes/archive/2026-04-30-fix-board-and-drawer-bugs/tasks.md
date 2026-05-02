## 1. TaskRepository — Backend Foundation

- [x] 1.1 Create `src/bun/db/task-repository.ts` with a `TaskRepository` class; inject `Database` via constructor; implement `findById(id: number): Task | null` using LEFT JOIN on `task_git_context` (reuse the query already in `handlers/tasks.ts` `fetchTaskWithDetail`)
- [x] 1.2 Export `TaskRepository` from `src/bun/db/index.ts` (or equivalent barrel) so downstream consumers can import it cleanly

## 2. Bug #1 — Fix stale execution state returned from transition

- [x] 2.1 In `src/bun/engine/execution/transition-executor.ts`, inject `TaskRepository` via constructor parameter
- [x] 2.2 After writing `execution_state = 'running'` and `current_execution_id` (line ~81), call `taskRepository.findById(taskId)` and use the fresh row as the return value instead of the earlier `updatedRow` snapshot

## 3. Bug #3 — Fix worktree fields wiped in stream-processor

- [x] 3.1 Inject `TaskRepository` into `StreamProcessor` via its constructor parameter
- [x] 3.2 In `stream-processor.ts` `finally` block (~line 474), replace `SELECT * FROM tasks WHERE id = ?` with `taskRepository.findById(taskId)` for the `task.updated` broadcast
- [x] 3.3 Remove the now-unused private `fetchTaskWithDetail` function from `src/bun/handlers/tasks.ts` (or keep it if still used elsewhere — verify first)

## 4. Bug #4 — Fix false failure / stream keeps going

- [x] 4.1 In `stream-processor.ts` `catch` block: add `this.abortControllers.get(executionId)?.abort()` before the existing `this.abortControllers.delete(executionId)` call
- [x] 4.2 In `stream-processor.ts` `catch` block: broadcast a `{ type: "done" }` stream event to the frontend after setting `execution_state = 'failed'`
- [x] 4.3 In `stream-processor.ts` `error: { fatal: true }` event handler: add `.abort()` call on the active controller for this execution before continuing
- [x] 4.4 In `stream-processor.ts` `error: { fatal: true }` event handler: broadcast a `{ type: "done" }` stream event

## 5. Bug #2 — Filter forbidden transitions in drawer

- [x] 5.1 In `TaskChatView.vue`, update the `columns` computed property to filter by `sourceCol?.allowedTransitions` — when the source column has a non-empty `allowedTransitions`, exclude any column whose `id` is not in that list

## 6. Bug #5 — Reasoning bubble autoscroll

- [x] 6.1 In `ReasoningBubble.vue`, add a `ref="bodyEl"` on the `.rb__body` element
- [x] 6.2 Add a `watch` on `props.content` that, when `props.streaming` is true, sets `bodyEl.value.scrollTop = bodyEl.value.scrollHeight`

## 7. Bug #7 — Fix autoscroll stutter in chat RAF loop

- [x] 7.1 In `ConversationBody.vue` `scrollToLatest()`, remove the `virtualizer.scrollToIndex(lastIndex)` call from the RAF loop body; keep `scrollToBottom()` as the sole scroll call during streaming
- [x] 7.2 Ensure `virtualizer.scrollToIndex` is still called for non-streaming navigation (e.g., initial load jump-to-bottom) — verify those call sites are outside the RAF loop

## 8. Bug #6 — Fix infinite scroll sentinel

- [x] 8.1 In `ConversationBody.vue`, add a `watch` on `autoScroll`; when it transitions from `true` to `false`, check if `sentinelEl.value` `getBoundingClientRect()` is within the `scrollEl.value` visible bounds
- [x] 8.2 If the sentinel is visible at that moment, emit `load-older` immediately (guard with `if (!scrollEl.value) return` to handle unmounting)
