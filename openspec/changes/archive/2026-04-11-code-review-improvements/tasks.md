## 1. Bug Fix: LineCommentBar

- [ ] 1.1 Remove the `onMounted` auto-focus block from `LineCommentBar.vue` (the double `requestAnimationFrame` focus call)
- [ ] 1.2 Add `html.dark-mode` CSS overrides to `LineCommentBar.vue` matching pattern in `HunkActionBar.vue`: `.line-comment-bar` background, `.line-comment-bar__textarea` background/border/color, `.lcb-btn` colours

## 2. DB Migration: task_execution_checkpoints

- [ ] 2.1 Add migration in `src/bun/db/migrations.ts`: `CREATE TABLE IF NOT EXISTS task_execution_checkpoints (execution_id INTEGER PRIMARY KEY REFERENCES executions(id), stash_ref TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`
- [ ] 2.2 Wire migration into the existing DB startup migration runner

## 3. Shared Types

- [ ] 3.1 Add `ManualEdit` interface to `rpc-types.ts`: `{ filePath: string; unifiedDiff: string }`
- [ ] 3.2 Add `manualEdits?: ManualEdit[]` field to `CodeReviewPayload`
- [ ] 3.3 Add `tasks.writeFile` IPC signature: `{ params: { taskId: number; filePath: string; content: string }; response: void }`
- [ ] 3.4 Add `GitNumstat` type: `{ files: { path: string; additions: number; deletions: number }[]; totalAdditions: number; totalDeletions: number }`
- [ ] 3.5 Update `tasks.getGitStat` return type to `GitNumstat | null`
- [ ] 3.6 Add `tasks.getPendingHunkCounts` IPC signature: `{ params: { taskId: number }; response: Record<string, number> }`

## 4. Backend: tasks.writeFile + getGitStat + getPendingHunkCounts

- [ ] 4.1 Implement `tasks.writeFile`: get `worktree_path` from `task_git_context`, `Bun.write(path.join(worktreePath, filePath), content)`; validate no path traversal
- [ ] 4.2 Replace `tasks.getGitStat` implementation: run `git diff --numstat HEAD`, parse into `GitNumstat`, return `null` if no changes
- [ ] 4.3 Implement `tasks.getPendingHunkCounts`: query unsent pending hunk decisions grouped by file_path, return `Record<string, number>`
- [ ] 4.4 Register all new handlers in `src/bun/handlers/tasks.ts`

## 5. Backend: git stash checkpoint per AI turn

- [ ] 5.1 In `runExecution` in `engine.ts`, at the START (before first `provider.chat` call): run `git stash create` in `worktreePath`, capture SHA output
- [ ] 5.2 If SHA is non-empty, insert into `task_execution_checkpoints(execution_id, stash_ref)`
- [ ] 5.3 Update `readFileDiffContent` in `tasks.ts`: query latest checkpoint from a prior review round; if found and file is tracked, use `git diff <stash_ref> -- <file>`; otherwise fall back to `git diff HEAD -- <file>`
- [ ] 5.4 Apply the same checkpoint-aware diff in `handleCodeReview` when populating `originalLines`/`modifiedLines`

## 6. Backend:  manual edits sectionformatReviewMessageForLLM 

- [ ] 6.1 In `review.ts`, add `manualEdits` handling: render `MANUAL EDITS` section after line comments
- [ ] 6.2 Format each `ManualEdit` as indented unified diff block
- [ ] 6.3 Include `manualEdits` in the `hasActionable` check

## 7. Frontend:  editable + enableCommentsMonacoDiffEditor 

- [ ] 7.1 Rename prop `reviewMode` to `enableComments`; update all call sites in `CodeReviewOverlay.vue`
- [ ] 7.2 Remove `readOnly: true` from `createDiffEditor` options; add `editor.getModifiedEditor().updateOptions({ readOnly: false })` in `initEditor`
- [ ] 7.3 Add new emit `contentChange: [filePath: string, content: string]`; fire from `onDidChangeModelContent`; add `filePath?: string` prop

## 8. Frontend:  live-save + flush-before-reject + splitterCodeReviewOverlay 

- [ ] 8.1 Add `fileListWidth: ref<number>` initialized from `localStorage('railyin:review-file-list-width') ?? 220`; bind to `ReviewFileList` as style
- [ ] 8.2 Add `.review-overlay__splitter` drag handle between `ReviewFileList` and diff panel; implement mousedown/mousemove/mouseup drag logic; clamp 500; save to localStorage on mouseup150
- [ ] 8.3 Pass `:file-path="reviewStore.selectedFile"` and `:enable-comments="true"` to `MonacoDiffEditor`
 `tasks.writeFile`; track `editedFiles: Set<string>`
- [ ] 8.5 In `onDecideHunk` reject path: flush `tasks.writeFile` immediately if file in `editedFiles`; show toast warning
- [ ] 8.6 At `onSubmit`: for each file in `editedFiles`, compute `createPatch(filePath, diffContent.modified, currentEditorContent)`; include as `manualEdits` in sendMessage payload
- [ ] 8.7 Clear `editedFiles` and pending debounce on file switch and overlay close

## 9. Frontend:  search + two-line layout + width propReviewFileList 

- [ ] 9.1 Add `width?: number` prop; apply as inline style; remove hardcoded CSS `width: 220px`
- [ ] 9.2 Add `searchQuery: ref('')`; filter files by case-insensitive match on full path
- [ ] 9.3 Add search input at top, dark-mode styled
- [ ] 9.4 Change item to two-line stacked layout: filename bold on line 1, directory path muted on line 2
- [ ] 9.5 Add `title` attribute on each `<li>` = full path

## 10. Frontend: ChangedFilesPanel (new component)

- [ ] 10.1 Create `src/mainview/components/ChangedFilesPanel.vue` with prop `taskId: number`
- [ ] 10.2 On mount/taskId change: call `tasks.getPendingHunkCounts` and `tasks.getGitStat` in parallel
- [ ] 10.3 Pending state (any pending hunk count > 0): header shows hunk count + file count + Review button; items show filename + hunk count per file
N + file count + View Changes button; items show file + additions/deletions
- [ ] 10.5 Collapsible (default expanded); toggle on header click (not button click)
- [ ] 10.6 Review/View Changes button always visible right-aligned in header; opens overlay; clicking file row sets `reviewStore.selectedFile`
- [ ] 10.7 Dark mode CSS; same border-top + background as `TodoPanel`
- [ ] 10.8 Expose `refresh()` method

## 11. Frontend:  wire ChangedFilesPanelTaskDetailDrawer 

- [ ] 11.1 Place `<ChangedFilesPanel>` between `<TodoPanel>` and chat input; pass `:task-id`; hold ref for `refresh()`
- [ ] 11.2 Remove `gitStat` `<pre>` block from side panel and `gitStat` ref/fetch logic
- [ ] 11.3 Remove `drawer-header__changed-badge` span from header
- [ ] 11.4 Call `changedFilesPanelRef.value?.refresh()` after `syncChangedFiles`
- [ ] 11.5 Call `changedFilesPanelRef.value?.refresh()` after new `code_review` message received

## 12. Frontend:  improvedCodeReviewCard 

- [ ] 12.1 Filter displayed hunks to only `rejected` and `change_request`
- [ ] 12.2 Add `lineComments` section: grouped by file, `       line N: "comment"`path 
- [ ] 12.3 Add `manualEdits` section: collapsible `<details>` per file with unified diff in `<pre>`
- [ ] 12.4 Update badge counts: only rejected, change_request, line comment count, manual edit count
- [ ] 12.5 Handle `payload.manualEdits` being undefined (backward-compat)
- [ ] 12.6 Add dark mode CSS for diff `<pre>` block

## 13. Backend:  pass manualEdits throughhandleCodeReview 

- [ ] 13.1 In `tasks.sendMessage` handler, extract `manualEdits` from parsed JSON content; pass to `handleCodeReview`
- [ ] 13.2 Update `handleCodeReview` signature to accept `manualEdits?: ManualEdit[]`
- [ ] 13.3 Include `manualEdits` in `CodeReviewPayload`; store in `code_review` conversation message

## 14. Install diff package

- [ ] 14.1 Run `bun add diff` and `bun add -d @types/diff`
- [ ] 14.2 Import `createPatch` from `'diff'` in `CodeReviewOverlay.vue`

## 15. UI Tests

- [ ] 15.1 Suite M: glyph click opens `LineCommentBar` zone in open state
- [ ] 15.2 Suite M: textarea NOT auto-focused (is clickable when user clicks)
- [ ] 15.3 Suite N: cancel removes zone without IPC call
- [ ] 15.4 Suite O: post saves comment, transitions to posted state, DB row correct
- [ ] 15.5 Suite P: delete removes zone and DB row
- [ ] 15.6 Suite Q: accept hunk applies green decoration, no model rebuild
- [ ] 15.7 Suite R: submit payload includes line comments and hunk diffs
- [ ] 15.8 Suite S: decisions and line comments marked sent=1 after submit
- [ ] 15.9 Suite T: after submit + reopen, no prior-round comment bars rendered
- [ ] 15.10 Dark mode: LineCommentBar textarea has dark background when html.dark-mode is set
- [ ] 15.11 File list search: search input filters displayed files
- [ ] 15.12 Splitter drag: changes file list width and persists to localStorage
- [ ] 15.13 Live-save: editing Monaco modified side triggers `tasks.writeFile` after debounce
- [ ] 15.14 Manual edits in submit: payload contains `manualEdits` with correct `unifiedDiff`
- [ ] 15.15 Flush-before-reject: toast shown and `tasks.writeFile` called before `tasks.rejectHunk`
- [ ] 15.16 ChangedFilesPanel pending state: shown when unsent hunk decisions exist
- [ ] 15.17 ChangedFilesPanel reviewed state: shown after submit
- [ ] 15.18 Checkpoint: `task_execution_checkpoints` row inserted after AI turn completes
- [ ] 15.19 Checkpoint diff: second review round uses stash ref, not HEAD

## 16. Specs Sync

- [ ] 16.1 Run `/opsx:sync-specs` after implementation to merge delta specs into main specs
