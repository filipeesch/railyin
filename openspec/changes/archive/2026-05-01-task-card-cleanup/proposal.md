## Why

Task cards on the board display stale noise (file-change counter, retry count) while omitting the most contextually useful piece of information: which project the task belongs to. As boards grow to hold tasks across multiple projects, users cannot tell at a glance where each task lives without opening the detail drawer.

## What Changes

- **Add project name** to the card footer — right-aligned in the same row as the execution badge.
- **Remove file-changes counter** (`⬡ N`) — code review is already fully accessible from the task drawer via `ChangedFilesPanel` in `TaskChatView`; the card badge is redundant.
- **Remove retry count** (`↺ N`) — low-signal noise; retry detail is available in the task drawer.
- **Clean up dead code** that exclusively served the removed badge: `openReview` emit chain (`TaskCard` → `BoardColumn` → `BoardView`), `changedFileCounts` prop threading, and `refreshChangedFiles` / `changedFileCounts` state in `taskStore` (keeping only the `file_diff` unread-marking logic, which is a separate concern).
- **No automated test for truncation** — long-name ellipsis is a CSS-only concern (`text-overflow: ellipsis`); asserting computed styles in Playwright is fragile and provides no logic coverage. Layout correctness is verified by visual inspection.

## Capabilities

### New Capabilities

- `task-card-display`: Visual display contract for what information a task card shows on the board, and where each element is positioned.

### Modified Capabilities

*(none — no existing spec-level requirements change; the task and board specs describe task state fields, not card layout)*

## Impact

- **`src/mainview/components/TaskCard.vue`** — add `useProjectStore()`, add project name label, remove badge/retry markup and CSS.
- **`src/mainview/components/BoardColumn.vue`** — remove `changedFileCounts` prop, `open-review` emit, simplify `v-memo`.
- **`src/mainview/views/BoardView.vue`** — remove `:changed-file-counts` bindings, `@open-review` handlers, `onOpenReview` function.
- **`src/mainview/stores/task.ts`** — remove `changedFileCounts` ref, `refreshChangedFiles` function, and their call sites; retain `file_diff` handling for unread detection.
- No backend changes. No RPC contract changes. No new API calls.
