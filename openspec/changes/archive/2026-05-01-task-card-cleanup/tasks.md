## 1. TaskCard — add project name, remove badge and retry

- [x] 1.1 Add `useProjectStore()` import and call, compute `projectName` from `task.projectKey` with fallback to key string
- [x] 1.2 Add project name `<span>` to the footer row (right side), styled as small muted text with ellipsis truncation
- [x] 1.3 Add `justify-content: space-between` to `.task-card__footer` CSS
- [x] 1.4 Remove `changedCount` computed and the `⬡` changed-files badge markup + CSS
- [x] 1.5 Remove retry count `↺` display markup + CSS
- [x] 1.6 Remove `openReview` from `defineEmits` declaration

## 2. BoardColumn — remove changedFileCounts prop and open-review emit

- [x] 2.1 Remove `changedFileCounts` from `defineProps`
- [x] 2.2 Remove `open-review` from `defineEmits`
- [x] 2.3 Remove `changedFileCounts[task.id]` from the `v-memo` dependency array on `<TaskCard>`
- [x] 2.4 Remove `@open-review` passthrough event binding on `<TaskCard>`

## 3. BoardView — remove changed-file-counts bindings and onOpenReview

- [x] 3.1 Remove `:changed-file-counts` and `@open-review` bindings from both `<BoardColumn>` usages (grouped lanes and standard lane)
- [x] 3.2 Remove `onOpenReview` function and its `api("tasks.getChangedFiles")` call
- [x] 3.3 Remove `reviewStore` import and `const reviewStore` if no longer used after step 3.2 (verify no other usages in the file)

## 4. taskStore — remove changedFileCounts state and refreshChangedFiles

- [x] 4.1 Remove `changedFileCounts` ref declaration
- [x] 4.2 Remove `refreshChangedFiles` async function
- [x] 4.3 Remove `refreshChangedFiles(task.id)` call in `onTaskUpdated` (on `executionState === "completed"`)
- [x] 4.4 Remove `refreshChangedFiles(event.taskId)` call in `onTaskStreamEvent` `file_diff` branch — keep the rest of the branch for unread detection
- [x] 4.5 Remove `refreshChangedFiles(message.taskId)` call in `onTaskNewMessage` `file_diff` branch — keep the rest of the branch for unread detection
- [x] 4.6 Remove `changedFileCounts` and `refreshChangedFiles` from the store's `return` object
- [x] 4.7 Remove `delete changedFileCounts.value[taskId]` line in `deleteTask`
