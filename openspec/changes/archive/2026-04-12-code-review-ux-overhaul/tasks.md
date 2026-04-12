## 1. Dependencies

- [x] 1.1 Add `diff` npm package: `npm install diff && npm install --save-dev @types/diff`

## 2. DB Migration

- [x] 2.1 Create `task_execution_checkpoints` table: `execution_id INTEGER PRIMARY KEY REFERENCES executions(id)`, `stash_ref TEXT` (nullable — NULL when worktree was clean), `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- [x] 2.2 Wire migration into the existing DB startup migration runner (same pattern as other table migrations)

## 3. Shared Types

- [x] 3.1 Add `ManualEdit` interface to `rpc-types.ts`: `{ filePath: string; unifiedDiff: string }`
- [x] 3.2 Add `manualEdits?: ManualEdit[]` to `CodeReviewPayload`
- [x] 3.3 Add `GitFileNumstat` and `GitNumstat` interfaces: `{ files: { path: string; additions: number; deletions: number }[]; totalAdditions: number; totalDeletions: number }`
- [x] 3.4 Add `tasks.writeFile` IPC signature: `params: { taskId: number; filePath: string; content: string }; response: void`
- [x] 3.5 Add `tasks.getPendingHunkSummary` IPC signature: `params: { taskId: number }; response: { filePath: string; pendingCount: number }[]`
- [x] 3.6 Update `tasks.getGitStat` return type from `string | null` to `GitNumstat | null`
- [x] 3.7 Add optional `checkpointRef?: string` param to `tasks.getFileDiff`

## 4. IPC Handlers (Backend)

- [x] 4.1 Implement `tasks.writeFile`: resolve `worktreePath` from `task_git_context`; validate resolved absolute path starts with `worktreePath` (path traversal guard); write content with `Bun.write`
- [x] 4.2 Implement `tasks.getPendingHunkSummary`: `SELECT file_path, COUNT(*) as pendingCount FROM task_hunk_decisions WHERE task_id = ? AND sent = 0 AND decision = 'pending' GROUP BY file_path`; return array
- [x] 4.3 Update `tasks.getGitStat`: replace `git diff --stat HEAD` with `git diff --numstat HEAD`; parse tab-separated output into `GitNumstat`; return `null` when no changes
- [x] 4.4 Update `tasks.getFileDiff`: accept optional `checkpointRef`; when provided, run `git diff <checkpointRef> HEAD -- <file>` instead of `git diff HEAD -- <file>`; fall back to HEAD diff if checkpoint ref is empty/null
- [x] 4.5 Register `tasks.writeFile` and `tasks.getPendingHunkSummary` in `src/bun/handlers/tasks.ts`

## 5. Per-Turn Checkpoints (Backend)

- [x] 5.1 In `runExecution` (engine.ts), at the very start (before `assembleMessages`): run `git stash create` in `worktreePath`; capture stdout as `stashRef` (trim); if empty string (clean worktree), store `NULL`
- [x] 5.2 Insert into `task_execution_checkpoints(execution_id, stash_ref)` after obtaining the stash ref
- [x] 5.3 Wrap in try/catch — if `git stash create` fails, log warning and continue without checkpoint (don't abort the AI turn)
- [x] 5.4 In `handleCodeReview` (engine.ts): query the most recent `task_execution_checkpoints` row where the execution has unsent hunk decisions; pass its `stash_ref` to `readFileDiffContent` as `checkpointRef`
- [x] 5.5 Update `readFileDiffContent` to accept and use `checkpointRef` when building the diff command

## 6. LineCommentBar Fixes

- [x] 6.1 Remove `onMounted` auto-focus block from `LineCommentBar.vue` (the double-`requestAnimationFrame` + `textareaEl.value?.focus()` call)
- [x] 6.2 Add `html.dark-mode .line-comment-bar` CSS rule: `background: #1e293b; border-left-color: var(--p-blue-400, #60a5fa)`
- [x] 6.3 Add `html.dark-mode .line-comment-bar__textarea` CSS rule: `background: #0f172a; border-color: #475569; color: #e2e8f0`
- [x] 6.4 Add `html.dark-mode .line-comment-bar__textarea:focus` CSS rule: `border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25)`
- [x] 6.5 Add `html.dark-mode .lcb-btn` CSS rule: `background: #1e293b; color: #cbd5e1; border-color: #475569`
- [x] 6.6 Add `html.dark-mode .lcb-btn--post` CSS rule: `background: var(--p-blue-500, #3b82f6); color: #fff; border-color: var(--p-blue-500, #3b82f6)`
- [x] 6.7 Add `html.dark-mode .lcb-btn--delete` CSS rule: `color: #f87171; border-color: #7f1d1d`
- [x] 6.8 Add `html.dark-mode .line-comment-bar__range-label` and `.line-comment-bar__comment-text` dark rules

## 7. MonacoDiffEditor — Editable + enableComments

- [x] 7.1 Remove top-level `readOnly: true` from `createDiffEditor` options
- [x] 7.2 After `editor.setModel(...)` in `applyModels`, call `editor.getOriginalEditor().updateOptions({ readOnly: true })` and `editor.getModifiedEditor().updateOptions({ readOnly: false })`
- [x] 7.3 Rename prop `reviewMode` → `enableComments` (update all usages in `MonacoDiffEditor.vue` and `CodeReviewOverlay.vue`)
- [x] 7.4 Register `editor.getModifiedEditor().onDidChangeContent(() => emit('contentChange', editor.getModifiedEditor().getValue()))` in `registerReviewHandlers` (or a separate `registerContentHandlers` call from `initEditor`)
- [x] 7.5 Add `contentChange: [value: string]` to the `defineEmits` in `MonacoDiffEditor.vue`

## 8. CodeReviewOverlay — Resizable Splitter + Edit Tracking + Checkpoint

- [ ] 8.1 Add `fileListWidth` ref (default: load from `localStorage('railyn:review-file-list-width')` or 220); bind as `:style="{ width: fileListWidth + 'px' }"` on the `ReviewFileList` component wrapper
- [ ] 8.2 Add `<div class="review-overlay__splitter" @mousedown.prevent="startSplitterDrag">` between `ReviewFileList` and the diff panel
- [ ] 8.3 Implement `startSplitterDrag`: on `mousemove`, update `fileListWidth = Math.min(500, Math.max(150, e.clientX - overlayEl.getBoundingClientRect().left))`; on `mouseup`, save to localStorage; clean up listeners
- [ ] 8.4 Add CSS: `.review-overlay__splitter { width: 4px; cursor: col-resize; background: var(--p-content-border-color); flex-shrink: 0; } .review-overlay__splitter:hover { background: var(--p-blue-400); }`
- [ ] 8.5 Add `editedContent: Map<string, string>` and `editedFiles: Set<string>` refs in `CodeReviewOverlay`
- [ ] 8.6 Handle `@content-change="onContentChange"` from `MonacoDiffEditor`: debounce 500ms, call `tasks.writeFile`, add to `editedFiles`
- [ ] 8.7 On file switch (`clearAllZones`): flush any pending debounce write for the outgoing file before switching
- [ ] 8.8 On overlay close: flush pending debounce writes for all `editedFiles`
- [ ] 8.9 In `onDecideHunk` reject path: before calling `tasks.rejectHunk`, flush debounce write for current file; after diff reloads, show toast if file was in `editedFiles`: *"Manual edits to `<file>` were also reverted by this rejection"*; remove from `editedFiles`
- [ ] 8.10 On overlay open: load checkpoint ref — query `tasks.getPendingHunkSummary` to detect if pending hunks exist; if yes, also fetch checkpoint ref from `tasks.getCheckpointRef({ taskId })` (new IPC, see 4.4) and pass to `tasks.getFileDiff`
- [ ] 8.11 Pass `enableComments: true` to `MonacoDiffEditor` (replaces `reviewMode`)
- [ ] 8.12 Add `tasks.getCheckpointRef` IPC: `params: { taskId: number }; response: string | null` — queries the most recent execution checkpoint for unsent hunk decisions

## 9. ReviewFileList — Search + Two-Line Layout

- [ ] 9.1 Add `filterText` ref; add `<input type="search" placeholder="Filter files…" v-model="filterText" class="review-file-list__search">` as first child of `<nav>`
- [ ] 9.2 Add computed `filteredFiles`: `files.filter(f => f.path.toLowerCase().includes(filterText.toLowerCase()))`
- [ ] 9.3 Change `v-for` to iterate `filteredFiles`
- [ ] 9.4 Update each file item to two-line layout: `<span class="review-file-list__name">{{ basename(f.path) }}</span>` (bold) + `<span class="review-file-list__dir">{{ dirname(f.path) }}</span>` (dimmed, below)
- [ ] 9.5 Add `title="{{ file.path }}"` to the `<li>` for full-path tooltip
- [ ] 9.6 Remove fixed `width: 220px` from `.review-file-list` CSS (width now controlled by parent splitter); set `width: 100%`
- [ ] 9.7 Add CSS for search input: full-width, consistent with overlay dark theme; clear button via `type="search"` native appearance
- [ ] 9.8 Add `html.dark-mode` CSS overrides for the search input

## 10. ChangedFilesPanel Component (New)

- [ ] 10.1 Create `src/mainview/components/ChangedFilesPanel.vue`
- [ ] 10.2 Props: `taskId: number`, `numstat: GitNumstat | null`, `pendingByFile: { filePath: string; pendingCount: number }[]`
- [ ] 10.3 Computed `hasPending`: `pendingByFile.length > 0`
- [ ] 10.4 Collapsed header row: toggle icon (`▶`/`▼`), summary text, right-aligned Review button
  - Primary (`hasPending`): `▼  N hunks pending · M files   [ 🔍 Review ]`
  - Secondary: `▼  +N −M · K files changed   [ 🔍 View Changes ]`
- [ ] 10.5 Expanded list (primary state): one row per file in `pendingByFile`; decision icon + filename + `N hunks` count; small "show all ↗" link at bottom
- [ ] 10.6 Expanded list (secondary state): one row per file in `numstat.files`; decision icon from `aggregateStates` + filename + `+N −N`
- [ ] 10.7 Emit `openReview: [filePath: string | null, mode: 'review' | 'changes']` on button or row click
- [ ] 10.8 Style: same `border-top`, `background`, padding as `TodoPanel` for visual consistency; `+N` green, `−N` red
- [ ] 10.9 Filename display: basename bold + dir path dimmed below (same two-line pattern as ReviewFileList); `title` tooltip with full path
- [ ] 10.10 Dark mode CSS overrides

## 11. TaskDetailDrawer — Wire ChangedFilesPanel

- [ ] 11.1 Import and add `<ChangedFilesPanel>` between `<TodoPanel>` and `<div class="task-detail__input">`
- [ ] 11.2 Pass `taskId`, `numstat` (from `getGitStat`), `pendingByFile` (from `getPendingHunkSummary`) as props
- [ ] 11.3 On `@open-review` emit: call `openReviewOverlay(filePath, mode)` — update `openReviewOverlay` to accept optional filePath and mode; set `reviewStore.selectedFile` if provided; set `reviewStore.mode` to passed mode
- [ ] 11.4 Remove the `gitStat` `<pre>` block from the sidebar (`side-section` with `side-git-stat`)
- [ ] 11.5 Remove the `drawer-header__changed-badge` `<span>` from the drawer header
- [ ] 11.6 Update `gitStat` ref type to `GitNumstat | null`; update `taskStore.getGitStat` call to use new return type
- [ ] 11.7 Add `pendingByFile` ref; fetch via `tasks.getPendingHunkSummary` on task load and after each `syncChangedFiles`

## 12. CodeReviewCard — Actionable-Only Display

- [ ] 12.1 Filter hunks to `rejected` and `change_request` only (remove `pending` and `accepted` from rendered list)
- [ ] 12.2 Update `stats` computed to count only `rejected`, `change_request`, line comments, and manual edits
- [ ] 12.3 Remove file count from header; show only non-zero action counts: `❌ N  📝 N  💬 N  ✏️ N`
- [ ] 12.4 If all hunks were accepted and no line comments/manual edits: show "✅ All changes accepted — no action required" in body
- [ ] 12.5 Add line comments section in expanded body: heading `💬 LINE COMMENTS`; list each `lineComment` as `filePath · line N` + comment text
- [ ] 12.6 Add manual edits section: heading `✏️ MANUAL EDITS`; for each `manualEdit`, render `<details><summary>{{ filePath }} (manually edited)</summary><pre class="mini-diff">{{ unifiedDiff }}</pre></details>`
- [ ] 12.7 Import and use `diff` package in `CodeReviewCard` for any client-side diff rendering needs (unified diff is stored in `manualEdit.unifiedDiff`, so this may be display-only)
- [ ] 12.8 Add CSS for `.mini-diff`: monospace, font-size 11px, `+` lines green, `-` lines red (simple line-start check in template or CSS `::before` trick)
- [ ] 12.9 Dark mode CSS overrides for new sections

## 13. formatReviewMessageForLLM — Manual Edits Section

- [ ] 13.1 In `review.ts`, add a `manualEditItems` array; for each `payload.manualEdits`, push a formatted block:
  ```
  ✏️ MANUAL EDITS — user directly modified files (already on disk):
    • src/auth.ts
      @@ -12,3 +12,3 @@
      - const isValid = token.length > 0;
      + const isValid = verifyTokenSignature(token);
  ```
- [ ] 13.2 Add manual edits section to the assembled message string (after line comments section)
- [ ] 13.3 Update `hasActionable` check to include `manualEditItems.length > 0`

## 14. UI Tests

- [ ] 14.1 Add test (Suite M): glyph click opens LineCommentBar (existing suite M from `code-review-line-comments` tasks.md, now implement it)
- [ ] 14.2 Add test (Suite M): textarea is NOT auto-focused (verify `document.activeElement` is not the textarea immediately after zone injection)
- [ ] 14.3 Add test (Suite M): clicking textarea focuses it
- [ ] 14.4 Add test (Suite N): cancel removes comment zone, no IPC call
- [ ] 14.5 Add test (Suite O): posting a comment persists it, bar transitions to posted state, DB row correct
- [ ] 14.6 Add test (Suite P): delete a posted comment removes zone and DB row
- [ ] 14.7 Add test (Suite Q): accept hunk applies green decoration, removes action bar ViewZone
- [ ] 14.8 Add test (Suite R): submit payload includes LINE COMMENTS and mini-diff blocks
- [ ] 14.9 Add test (Suite S): hunk decisions and line comments marked sent=1 after submit
- [ ] 14.10 Add test (Suite T): after submit + reopen, no prior-round comment bars rendered
- [ ] 14.11 Add test (Suite U — splitter): drag the splitter and verify `ReviewFileList` width changes; verify width persists in localStorage
- [ ] 14.12 Add test (Suite V — editable): type in Monaco modified editor; verify `tasks.writeFile` IPC called with correct content after debounce
- [ ] 14.13 Add test (Suite V): reject a hunk on a file with edits; verify toast shown; verify file in `editedFiles` cleared
- [ ] 14.14 Add test (Suite W — checkpoints): after an AI turn, verify `task_execution_checkpoints` row exists for the execution
- [ ] 14.15 Add test (Suite W): open review after checkpoint; verify `tasks.getFileDiff` called with `checkpointRef`
- [ ] 14.16 Add test (Suite X — ChangedFilesPanel): panel shows pending state when unsent hunk decisions exist
- [ ] 14.17 Add test (Suite X): clicking "Review" button opens overlay in review mode
- [ ] 14.18 Add test (Suite X): clicking "show all" opens overlay in changes mode
- [ ] 14.19 Add test (Suite X): after submit, panel transitions to secondary (all reviewed) state
- [ ] 14.20 Add test (Suite Y — CodeReviewCard): accepted hunks not shown in expanded body
- [ ] 14.21 Add test (Suite Y): line comments appear in card body
- [ ] 14.22 Add test (Suite Y): manual edits appear in card body with collapsed mini-diff
- [ ] 14.23 Add test (Suite Z — file list): typing in search input filters the file list
- [ ] 14.24 Add test (Suite Z): dark-mode textarea in LineCommentBar has correct background color

## 15. Specs Sync

- [ ] 15.1 Run `/opsx:sync-specs` after implementation to merge delta specs into main specs
