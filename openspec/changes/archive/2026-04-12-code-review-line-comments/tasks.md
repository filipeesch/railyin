## 1. DB Migration

- [x] 1.1 Create `task_line_comments` table migration with columns: `id` (PK autoincrement), `task_id`, `file_path`, `line_start`, `line_end`, `line_text` (JSON array), `context_lines` (JSON array, ±3 surrounding lines), `comment`, `reviewer_id` (default `'user'`), `reviewer_type` (default `'human'`), `sent` (default `0`), `created_at`
- [x] 1.2 Add index on `(task_id, file_path, sent)` for efficient per-file unsent queries
- [x] 1.3 Add `sent INTEGER NOT NULL DEFAULT 0` column to `task_hunk_decisions` via `ALTER TABLE`
- [x] 1.4 Add `original_end INTEGER NOT NULL DEFAULT 0` and `modified_end INTEGER NOT NULL DEFAULT 0` columns to `task_hunk_decisions` via `ALTER TABLE`
- [x] 1.5 Wire migration into the existing DB startup migration runner (same pattern as existing table migrations)

## 2. Shared Types

- [x] 2.1 Add `LineComment` interface to `rpc-types.ts`: `{ id: number; filePath: string; lineStart: number; lineEnd: number; lineText: string[]; contextLines: string[]; comment: string; reviewerType: 'human' | 'ai' }`
- [x] 2.2 Add `lineComments?: LineComment[]` field to `CodeReviewFile` interface (optional — populated at submit time)
- [x] 2.3 Add `originalLines?: string[]` and `modifiedLines?: string[]` fields to `CodeReviewHunk` interface (optional — populated at submit time)
- [x] 2.4 Add IPC method signatures to `rpc-types.ts`: `tasks.addLineComment`, `tasks.getLineComments`, `tasks.deleteLineComment`

## 3. IPC Handlers (Backend)

- [x] 3.1 Implement `tasks.addLineComment`: insert into `task_line_comments` with `sent = 0`, return the new `LineComment` record
- [x] 3.2 Implement `tasks.getLineComments`: query `task_line_comments WHERE task_id = ? AND sent = 0`, return `LineComment[]`
- [x] 3.3 Implement `tasks.deleteLineComment`: delete by `id` (validate `task_id` ownership)
- [x] 3.4 Update `tasks.setHunkDecision` to also persist `original_end` and `modified_end` values
- [x] 3.5 Register all new handlers in `src/bun/handlers/tasks.ts`

## 4. Submit Payload Extension (Backend)

- [x] 4.1 Extend `handleCodeReview` in `engine.ts` to read only unsent items: `SELECT * FROM task_hunk_decisions WHERE task_id = ? AND sent = 0 AND reviewer_id = 'user'`; same for line comments
- [x] 4.2 Include line comments in `CodeReviewPayload` grouped by `file_path`, populating `CodeReviewFile.lineComments`
- [x] 4.3 Populate `CodeReviewHunk.originalLines` and `modifiedLines` by re-parsing the git diff at submit time (run `git diff HEAD -- <file>` and extract hunk lines matching each decision's hash)
- [x] 4.4 Fix `CodeReviewHunk.originalRange` and `modifiedRange` to use correct `[start, end]` values from the new `original_end` / `modified_end` columns
- [x] 4.5 Extend `formatReviewMessageForLLM` to render each file's hunk decisions as mini-diff blocks (using `originalLines`/`modifiedLines`), followed by line comments as annotated context blocks (commented lines with `>` prefix, surrounded by context lines with line numbers)
- [x] 4.6 After building the payload, mark all included items as sent: `UPDATE task_hunk_decisions SET sent = 1 WHERE task_id = ? AND sent = 0`; same for `task_line_comments`

## 5. Remove Display-Model Patching (Frontend Refactor)

- [x] 5.1 Remove `buildDisplayModel()` function from `CodeReviewOverlay.vue`
- [x] 5.2 Remove `mapLineChangesToHunks()` function from `CodeReviewOverlay.vue`
- [x] 5.3 Remove `displayOriginal` / `displayModified` reactive refs; pass `diffContent.value.original` and `diffContent.value.modified` directly to `MonacoDiffEditor` props
- [x] 5.4 Remove `pendingScrollRestore` and `isInitialFileLoad` flags and their associated logic in `onHunksReady`
- [x] 5.5 Simplify `onDecideHunk` for accept/change_request: after DB write, apply `deltaDecorations` on the decided hunk's lines and update `HunkActionBar` state — no model rebuild, no `clearAllZones`
- [x] 5.6 Keep `onDecideHunk` for reject: `rejectHunk` returns new `FileDiffContent`, update `diffContent.value` which triggers Monaco model swap via prop watcher (existing behavior, no change needed)
- [x] 5.7 Simplify `injectViewZones`: instead of calling `mapLineChangesToHunks`, directly use each hunk's `modifiedEnd` as `afterLineNumber` for ViewZone placement (line numbers are now stable)

## 6. Decided Hunk Decorations (Frontend)

- [x] 6.1 Add `applyDecisionDecorations()` function: iterate `allHunks`, for each with `effectiveDecision !== 'pending'`, apply `deltaDecorations` on `modifiedEditor` with appropriate CSS class (`accepted-hunk-decoration` or `rejected-hunk-decoration`)
- [x] 6.2 Call `applyDecisionDecorations()` after `injectViewZones` in `onHunksReady` and after each `onDecideHunk` (accept/change_request path)
- [x] 6.3 Add CSS classes: `.accepted-hunk-decoration` (green tint background), `.rejected-hunk-decoration` (strikethrough + muted text)

## 7. MonacoDiffEditor — Glyph and Selection Triggers

- [x] 7.1 Accept new props from parent: `onRequestLineComment: (lineStart: number, lineEnd: number) => void` and `reviewMode: boolean`
- [x] 7.2 Register `editor.getModifiedEditor().onMouseMove(e)` handler: when `e.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN` and `reviewMode`, apply a glyph decoration (`glyphMarginClassName: 'line-comment-glyph'`) to the hovered line via `deltaDecorations`; remove it when the mouse leaves
- [x] 7.3 Register `editor.getModifiedEditor().onMouseDown(e)` handler: same glyph margin check — call `onRequestLineComment(lineNumber, lineNumber)` and prevent default
- [x] 7.4 Register `editor.getModifiedEditor().onDidChangeCursorSelection(e)` handler: when selection spans ≥2 lines and `reviewMode`, show a `ContentWidget` ("Add comment") positioned at `e.selection.endLineNumber`; hide ContentWidget when selection collapses to single line
- [x] 7.5 Wire ContentWidget click to call `onRequestLineComment(startLine, endLine)` with the full selection range and dismiss the ContentWidget

## 8. LineCommentBar Component (New)

- [x] 8.1 Create `src/mainview/components/LineCommentBar.vue` with props: `lineStart: number`, `lineEnd: number`, `state: 'open' | 'posted'`, `initialComment?: string`, callbacks `onPost(comment: string)`, `onCancel()`, `onDelete()`
- [x] 8.2 Implement `open` state: auto-focused textarea, Post button (disabled when empty/whitespace), Cancel button
- [x] 8.3 Implement `posted` state: read-only comment display with line range label, Delete button
- [x] 8.4 Apply same `@mousedown.stop @pointerdown.stop @keydown.stop @keyup.stop @keypress.stop` guards on root element as `HunkActionBar`
- [x] 8.5 Emit `heightChange` on textarea auto-resize (drives `layoutZone` in parent, same pattern as `HunkActionBar`)

## 9. CodeReviewOverlay — Unified Zone Registry and Line Comment Lifecycle

- [x] 9.1 Add separate `commentZones` Map for line comment zones alongside `hunkZones`; update `clearAllZones`, `layoutAllZones` to operate over both maps
- [x] 9.2 On file load: call `tasks.getLineComments` for the selected file; inject `LineCommentBar` ViewZones in `posted` state for each returned comment
- [x] 9.3 Handle `onRequestLineComment(lineStart, lineEnd)` from `MonacoDiffEditor`: inject a new `LineCommentBar` ViewZone in `open` state at `afterLineNumber = lineEnd`
- [x] 9.4 On `onPost(comment)` from an open `LineCommentBar`: call `tasks.addLineComment`, remap temp zone to persisted ID, re-mount in `posted` state
- [x] 9.5 On `onCancel()` from an open `LineCommentBar`: remove the ViewZone from the editor and delete from map; no IPC call
- [x] 9.6 On `onDelete()` from a posted `LineCommentBar`: call `tasks.deleteLineComment`; remove the ViewZone from the editor and delete from map
- [x] 9.7 On file switch: `clearAllZones` already clears both hunk and comment zones; `loadDiff` + `loadLineComments` reload all zones for the new file

## 10. CSS and Glyph Styling

- [x] 10.1 Add `.line-comment-glyph` CSS class in global styles (App.vue): `+` icon in the glyph margin using `::before` pseudo-element
- [x] 10.2 Style `LineCommentBar.vue` open state: left border accent, white background, consistent font
- [x] 10.3 Style `LineCommentBar.vue` posted state: inline posted display with muted range label and delete button

## 11. UI Tests

- [ ] 11.1 Add test: open review mode, trigger glyph click on a specific line, verify `LineCommentBar` ViewZone appears with focused textarea
- [ ] 11.2 Add test: simulate multi-line selection, verify ContentWidget appears; click it, verify range comment form opens for correct line range
- [ ] 11.3 Add test: open comment form, click Cancel, verify ViewZone is removed and no IPC call is made
- [ ] 11.4 Add test: post a comment, verify ViewZone transitions to `posted` state and `tasks.addLineComment` IPC is called with correct `lineText` and `contextLines`
- [ ] 11.5 Add test: delete a posted comment, verify ViewZone is removed and `tasks.deleteLineComment` IPC is called
- [ ] 11.6 Add test: submit a review with active line comments, verify the IPC payload for `tasks.sendMessage` contains `lineComments` for the file
- [ ] 11.7 Add test: submit a review, reopen the overlay, verify no prior-round comments are rendered
- [ ] 11.8 Add test: add a comment on a non-diff context line, verify it is accepted and appears in the payload
- [ ] 11.9 Add test: accept a hunk, verify `deltaDecorations` applied (green tint) and no model rebuild occurs
- [ ] 11.10 Add test: verify LLM submit payload includes `originalLines` and `modifiedLines` for reported hunks
- [ ] 11.11 Add test: verify submit marks hunk decisions and line comments as `sent = 1` (second submit sends only new items)

## 12. Specs Sync

- [ ] 12.1 Run `/opsx:sync-specs` after implementation to merge delta specs into main specs
