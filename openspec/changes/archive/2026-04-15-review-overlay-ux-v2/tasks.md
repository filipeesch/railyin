## 1. Data Model & Backend

- [x] 1.1 Add `col_start` and `col_end` columns to `task_line_comments` table (migration)
- [x] 1.2 Update `tasks.addLineComment` RPC handler to accept and store `colStart`/`colEnd`
- [x] 1.3 Update `tasks.getLineComments` RPC handler to return `colStart`/`colEnd`
- [x] 1.4 Add `colStart`/`colEnd` fields to the `LineComment` type in `rpc-types.ts`

## 2. Remove Gutter Comment Mechanism

- [x] 2.1 Remove `updateCommentGutterDecorations()` and `registerCommentGutterHandlers()` from InlineReviewEditor
- [x] 2.2 Remove `commentGutterDecorations` and `gutterHoverDecorations` reactive state
- [x] 2.3 Remove `.inline-review-comment-gutter` and `.inline-review-comment-gutter--hover` CSS classes

## 3. Floating Comment Button

- [x] 3.1 Add floating button `<div>` template element to InlineReviewEditor (outside Monaco)
- [x] 3.2 Add `onDidChangeCursorSelection` listener to show/hide button on non-empty selection
- [x] 3.3 Compute button position with `editor.getScrolledVisiblePosition()` relative to editor container
- [x] 3.4 Hide button on scroll (`onDidScrollChange`), selection collapse, and Escape key
- [x] 3.5 Emit `onRequestLineComment(startLine, endLine, startColumn, endColumn)` on button click
- [x] 3.6 Style floating button (semi-transparent, rounded, comment icon)

## 4. Column-Precise Comment Flow

- [x] 4.1 Thread `colStart`/`colEnd` through the comment ViewZone open/save lifecycle
- [x] 4.2 Pass column range from floating button click → `triggerLineComment()` → `addLineComment` RPC
- [x] 4.3 Display column range context (e.g. "L4:C19–C45") in LineCommentBar header

## 5. Inline Amber Highlight

- [x] 5.1 After posting/loading comments, add `inlineClassName` decorations for column-precise ranges
- [x] 5.2 Maintain `commentHighlightDecorations` Map for tracking decoration IDs per comment
- [x] 5.3 Add `.inline-review-comment-highlight` CSS with amber background (light/dark mode variants)
- [x] 5.4 Add `onMouseDown` listener to detect clicks on highlight decorations
- [x] 5.5 Toggle comment ViewZone visibility on highlight click (show/hide posted comment bar)
- [x] 5.6 Clean up highlight decorations on comment delete and editor disposal

## 6. File List CSS Dots & Aggregate State

- [x] 6.1 Replace `stateIcon()` emoji function in ReviewFileList with `dotClass()` returning CSS classes
- [x] 6.2 Add `.file-status-dot` CSS with pending (outline), accepted (green), rejected (red), CR (amber) variants
- [x] 6.3 Compute `fileAggregateStates` reactive Map in CodeReviewOverlay
- [x] 6.4 Update aggregate state on file load and hunk decision events
- [x] 6.5 Pass `:aggregate-states="fileAggregateStates"` prop to ReviewFileList

## 7. Submit Flow Changes

- [x] 7.1 Add silent close path in `onSubmit()` when all hunks accepted with no comments or edits
- [x] 7.2 Add PrimeVue Dialog template for pending-hunks confirmation
- [x] 7.3 Check for pending hunks across visited files on submit and show dialog
- [x] 7.4 Wire "Submit Anyway" button to proceed with existing submit logic
- [x] 7.5 Wire "Cancel" button to close dialog and return to overlay

## 8. Remove Auto-Navigation

- [x] 8.1 Remove `scrollToPendingHunk()` call from `onDecideHunk()` accept path
- [x] 8.2 Remove `navigateToNextFile()` call from `onDecideHunk()` when last hunk decided

## 9. LLM Payload Column Support

- [x] 9.1 Update `formatLineComment()` in `review.ts` to emit `L{line}:C{col}–C{col}` when colStart > 0
- [x] 9.2 Include exact selection text (backtick-wrapped) in the formatted comment output

## 10. Test Quality Retrofit

- [x] 10.1 Retrofit existing suites to assert after each individual UI action (click-by-click)
- [x] 10.2 Replace partial file content checks with full file text assertions
- [x] 10.3 Replace partial message checks with full message payload assertions

## 11. New Feature Tests

- [x] 11.1 Update existing comment tests (Suite M-P) to use floating button trigger instead of gutter
- [x] 11.2 Add test: floating button appears on text selection and hides on collapse
- [x] 11.3 Add test: column-precise comment stored and returned with correct colStart/colEnd
- [x] 11.4 Add test: inline amber highlight appears for column-precise posted comment
- [x] 11.5 Add test: click amber highlight toggles comment ViewZone
- [x] 11.6 Add test: file list shows CSS dots matching aggregate state
- [x] 11.7 Add test: submit with all accepted closes silently (no message sent)
- [x] 11.8 Add test: submit with pending hunks shows confirmation dialog
- [x] 11.9 Add test: accept hunk does not auto-scroll or auto-navigate
- [x] 11.10 Add test: LLM payload includes column range and selection text
