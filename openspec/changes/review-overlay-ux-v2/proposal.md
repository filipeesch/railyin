## Why

The review overlay has several bugs and UX gaps:

**Bugs:**
- **aggregateStates never wired**: `ReviewFileList` defines an `aggregateStates` prop and `stateIcon()` function, but `CodeReviewOverlay` never computes or passes it — every file shows the default state regardless of decisions.
- **Submit always sends message**: `onSubmit()` sends a `code_review` message to the LLM even when all hunks are accepted with no comments or edits, wasting tokens on a no-op "All changes were accepted" payload.
- **Gutter comment button unreliable**: The gutter "+" icon uses a 14px-wide Monaco mouse target (`GUTTER_LINE_DECORATIONS`, `MouseTargetType === 2`) that rarely registers hover, making comments hard to discover and click.

**UX improvements:**
- Comments are limited to full lines, losing precision on the exact code being annotated.
- The file list uses heavy emoji icons (⬜✅❌📝) that don't match the app's flat design.
- No confirmation when submitting with pending hunks remaining.
- Auto-navigation on hunk decisions can be disorienting.

**Test quality:**
- Existing tests batch multiple actions in `beforeAll` then scatter assertions across individual `test()` blocks. When `beforeAll` fails, the entire suite goes dark with no indication of which step broke.
- File content assertions use partial `.includes()` or `.slice(0, 500)` checks instead of verifying the complete file/message text, letting regressions in untested sections slip through.
- Submit payload tests (Suite R, tests 35–36.1) check for fragment presence (`includes("LINE COMMENT")`, `includes("```diff")`) instead of asserting the full structured message. A payload that contains the right keywords but is malformed still passes.
- Suites that test multi-step workflows (H: Change Request, I: decision persistence, X: multi-hunk accept) perform all actions in `beforeAll` and divide assertions across tests — if an intermediate step fails, only a misleading later test reports the failure.
- No tests exist for: selection-based commenting, column-precise comment persistence, pending-hunk confirmation dialog, silent close on all-accepted, aggregate file-list icons, or manual navigation without auto-jump.

## What Changes

- **Selection-based floating comment button**: Replace the gutter "+" mechanism entirely with a floating "💬 Comment" button that appears above text selections in review mode. Supports column-precise selections (e.g., L4:C19–C45). Remove all gutter comment code (`updateCommentGutterDecorations`, `registerCommentGutterHandlers`, related CSS).
- **Column-precise comments with inline highlighting**: Extend `task_line_comments` with `col_start` and `col_end` columns. Posted comments render as subtle amber `inlineClassName` decorations on the exact selected text. Clicking the highlight toggles the posted comment ViewZone (view/edit/delete). Full-line comments remain supported when `col_start = 0, col_end = 0`.
- **LLM payload includes exact selection text**: `formatReviewMessageForLLM` emits the selected text verbatim with column indicators (e.g., `L4:C19–C45: \`processData(input, options)\``) so the model sees exact code being discussed.
- **Flat CSS dot status icons in file list**: Replace emoji state icons in `ReviewFileList.vue` with 8px CSS circles — outline for pending, colored fill for decided states. Pass computed `aggregateStates` from `CodeReviewOverlay` to `ReviewFileList`.
- **Partial submit with confirmation dialog**: When pending hunks remain across files, show a PrimeVue `Dialog` confirming intent before submitting. When all hunks are accepted with no comments or manual edits, close the review silently without sending a message. Use cached `tasks.getFileDiff` data per-file to detect pending hunks (no new RPC needed).
- **Remove auto-navigation on hunk decision**: Accepting a hunk no longer auto-scrolls to the next pending hunk or auto-navigates to the next file. The user controls navigation explicitly via Prev/Next buttons.
- **Test quality retrofit**: Upgrade existing test suites to use click-by-click assertions (assert after each UI action), full file content assertions (compare entire file text instead of partial matches), and full message content assertions (assert complete LLM payloads). This applies to all existing suites, not just new feature tests. Specific changes:

  **Existing suite retrofits:**
  - **Suite H** (Change Request, tests 16–17): Currently performs both "CR without comment" and "CR with comment" sequences in a single `beforeAll`. Split into two independently-setup suites so each test owns its own action-then-assert sequence. Assert the full DB row (decision type, comment text, file path, hunk range) instead of just checking for a CSS class.
  - **Suite I** (Decision persistence, test 18): Currently checks only bar count after file switch. Add assertions for: (a) the exact accepted hunk is collapsed (no insertion decorations at its line range), (b) other hunks remain pending with their bars, (c) the pending counter text matches remaining hunks.
  - **Suite R** (Submit payload, tests 35–36.1): Replace `includes("LINE COMMENT")` / `includes("```diff")` fragment checks with full message content equality. Capture the complete LLM-formatted message and assert it matches an expected template with actual file paths, line numbers, and diff content. This catches structural regressions (e.g., missing section headers, wrong ordering, extra whitespace).
  - **Suite S** (Sent marking, tests 37–38): After asserting `sent=1`, also assert that reopening the overlay does not render any sent items (currently tested separately in Suite T — merge the check here as a post-condition).
  - **Suite X** (Multi-hunk accept, tests 46–49): Between each accept click, assert not just bar count but also the specific hunk-bar `data-hunk-index` values remaining, insertion decoration line ranges, and the `selectedFile` value. This makes regressions pinpointable to the exact accept step.

  **New test suites for new features:**
  - **Suite AA — Selection-based floating comment button**: (a) Select a text range via `executeEdits` + `setSelection`, assert the floating "Comment" button appears above the selection. (b) Click the button, assert a `LineCommentBar` zone appears. (c) Post the comment, assert the DB row has correct `col_start` / `col_end`. (d) Deselect text, assert the floating button disappears. (e) On a read-only file (if applicable), assert the button does not appear.
  - **Suite BB — Column-precise comment persistence**: (a) Post a column-precise comment (L4:C19–C45), switch files, switch back, assert the comment zone is still visible. (b) Assert the inline amber highlight decoration covers exactly cols 19–45 on line 4. (c) Click the highlight, assert the comment zone toggles to expanded view. (d) Delete the comment, assert both the zone and the highlight decoration are removed. (e) Assert the DB row is deleted.
  - **Suite CC — Flat CSS dot icons in file list**: (a) With all hunks pending, assert every file list item has an outline dot (`.file-status-dot--pending`). (b) Accept all hunks in one file, assert that file's dot becomes filled green (`.file-status-dot--accepted`). (c) Reject a hunk in another file, assert mixed-status file shows the appropriate icon. (d) Submit a Change Request, assert the icon updates to the CR color.
  - **Suite DD — Silent close on all-accepted (no message sent)**: (a) Accept every hunk across all files with no comments or manual edits. (b) Click Submit. (c) Assert the overlay closes. (d) Assert no new `code_review` or `user` message was added to `taskStore.messages` (compare message count before/after). (e) Assert no new row in `task_line_comments`.
  - **Suite EE — Pending hunk confirmation dialog**: (a) Accept only one hunk out of N, then click Submit. (b) Assert a PrimeVue `Dialog` appears with the pending count text. (c) Click "Cancel" in the dialog, assert the overlay remains open and no message is sent. (d) Click Submit again, click "Submit Anyway" in the dialog, assert the overlay closes and the message is sent. (e) Assert the dialog text includes the correct count of remaining pending hunks.
  - **Suite FF — No auto-navigation on hunk decision**: (a) Record `scrollTop` and `selectedFile` before accepting a hunk. (b) Accept the hunk. (c) Assert `scrollTop` has NOT changed (viewer did not auto-scroll to next hunk). (d) Assert `selectedFile` has NOT changed (did not auto-navigate to next file). (e) Accept the last hunk in the file, assert `selectedFile` still has NOT changed — user must navigate manually via Prev/Next.
  - **Suite GG — Submit payload with column-precise comments**: (a) Post a column-precise comment, accept some hunks, submit. (b) Assert the LLM message includes the column-precise citation (e.g., `L4:C19–C45: \`processData(input, options)\``). (c) Assert the selected text verbatim appears in the message. (d) Compare full message output against expected template.

  **New bridge helpers needed:**
  - `selectTextRange(startLine, startCol, endLine, endCol)` — programmatically set a Monaco selection for floating-button tests.
  - `getFileStatusIcons()` — returns `{ filePath: string, iconClass: string }[]` from the file list panel for icon assertion tests.
  - `getMessageCountForTask(taskId)` — returns total message count from `taskStore.messages` for before/after comparison in silent-close tests.
  - `getDialogState()` — returns `{ visible: boolean, text: string }` for PrimeVue Dialog assertions.
  - `getScrollTop()` — returns Monaco editor `scrollTop` value for no-auto-navigation assertions.

## Capabilities

### New Capabilities

_(none — all changes modify existing capabilities)_

### Modified Capabilities

- `code-review`: Submit flow changes (silent close on all-accepted, pending-hunk confirmation dialog, no auto-navigation on decision). File list gets aggregate state icons. LLM payload gains column-precise selection text.
- `code-review-viewzones`: Gutter comment mechanism replaced by selection-based floating button. Comment ViewZones gain column-precise range support with inline highlight decorations for posted comments.

## Impact

- `src/mainview/components/InlineReviewEditor.vue` — Remove gutter comment code, add floating button + selection listener, add inline highlight decorations for posted comments, add click-to-toggle-comment handler
- `src/mainview/components/CodeReviewOverlay.vue` — Compute and pass `aggregateStates` to ReviewFileList, update `onSubmit` for silent-close and pending dialog, remove auto-navigation from `onDecideHunk`, pass column data through comment lifecycle
- `src/mainview/components/ReviewFileList.vue` — Replace emoji `stateIcon()` with CSS dot elements
- `src/mainview/components/LineCommentBar.vue` — Accept column range display in header (e.g., "L4:C19–C45")
- `src/bun/workflow/review.ts` — `formatReviewMessageForLLM` emits column-precise selection text
- `src/bun/handlers/tasks.ts` — `addLineComment` / `getLineComments` handle `col_start` / `col_end` columns
- `src/bun/db/` — Migration: add `col_start INTEGER DEFAULT 0`, `col_end INTEGER DEFAULT 0` to `task_line_comments`
- `src/bun/handlers/tasks.ts` — New `tasks.getPendingHunkCount` RPC endpoint
- `src/shared/rpc-types.ts` — `LineComment` type gains `colStart` / `colEnd` fields
- `src/ui-tests/review-overlay.test.ts` — Retrofit suites H, I, R, S, X with click-by-click assertions and full content checks. Add 7 new suites (AA–GG): floating comment button, column-precise comments, CSS dot icons, silent close, pending dialog, no auto-navigation, column-precise submit payload. Update existing comment suites (M–P) to trigger via floating button instead of gutter glyph. ~800–1000 new lines of test code.
- `src/ui-tests/bridge.ts` — Add 5 new helpers: `selectTextRange`, `getFileStatusIcons`, `getMessageCountForTask`, `getDialogState`, `getScrollTop`
