## 1. InlineReviewEditor Component

- [ ] 1.1 Create `InlineReviewEditor.vue` with `monaco.editor.create()` setup (single editor, vs theme, automaticLayout, readOnly: false, lazy Monaco loading via `@monaco-editor/loader`)
- [ ] 1.2 Implement `renderHunks(hunks: HunkWithDecisions[])`: iterate backend hunks, create deletion ViewZones (red bg, strikethrough, `afterLineNumber: modifiedContentStart - 1`), insertion ModelDecorations (green bg, `modifiedContentStart` through `modifiedContentEnd`), and action bar ViewZones (mount `HunkActionBar` into each)
- [ ] 1.3 Implement deletion ViewZone syntax highlighting using `monaco.editor.colorize(deletedText, language)` with plain-text fallback
- [ ] 1.4 Implement three separate zone Maps (`deletionZones`, `actionBarZones`, `commentZones`) with `clearHunkVisuals(hash)`, `clearAllHunkVisuals()`, and `clearCommentZones()` operations
- [ ] 1.5 Implement ResizeObserver on action bar and comment ViewZone DOM nodes for dynamic height updates via `accessor.layoutZone(zoneId)`
- [ ] 1.6 Implement keyboard event isolation (`stopPropagation` on keydown/keyup/keypress within ViewZone DOM subtrees)
- [ ] 1.7 Implement Vue app lifecycle tracking — `app.unmount()` for all mounted HunkActionBar/LineCommentBar instances on editor disposal

## 2. Accept/Reject Integration

- [ ] 2.1 Implement accept handler: call `tasks.setHunkDecision()`, then `clearHunkVisuals(hash)` to remove deletion zone + insertion decorations + action bar zone (no model mutation)
- [ ] 2.2 Implement reject handler: call `tasks.rejectHunk()`, receive updated `FileDiffContent`, set editor model to new modified text, `clearAllHunkVisuals()`, re-render from fresh backend hunks
- [ ] 2.3 Implement change_request handler: call `tasks.setHunkDecision()`, transition action bar to "decided" visual state, keep deletion zone and insertion decorations visible
- [ ] 2.4 Implement decided-hunk rendering on file load: skip accepted/rejected hunks, render change_request hunks with decided visual state

## 3. CodeReviewOverlay Integration

- [ ] 3.1 Replace `MonacoDiffEditor` usage in `CodeReviewOverlay.vue` with `InlineReviewEditor` — update template, props, and event bindings
- [ ] 3.2 Remove `onHunksReady` / ILineChange correlation logic — replace with direct call to `renderHunks()` after `getFileDiff()` returns
- [ ] 3.3 Update navigation (Prev/Next): scroll to `hunk.modifiedStart` via `editor.revealLineInCenter()`, highlight action bar zone DOM node
- [ ] 3.4 Update cross-file navigation: on file switch, `clearAllHunkVisuals()` + `clearCommentZones()`, load new file diff, render hunks, load comments
- [ ] 3.5 Remove side-by-side toggle button and related state from overlay header
- [ ] 3.6 Wire `onDidChangeModelContent` → debounced `tasks.patchFile()` for manual edits during review, with 500ms debounce before `getFileDiff()` re-fetch and re-render

## 4. Line Comments

- [ ] 4.1 Implement `linesDecorationsClassName`-based comment gutter in `InlineReviewEditor`: invisible decoration on all commentable lines, visible "+" on hover via `onMouseMove`
- [ ] 4.2 Implement comment trigger on gutter click: check `editor.getSelection()` for multi-line range, emit comment request with line range to parent
- [ ] 4.3 Verify comment zone injection (`loadLineComments()`) and posting flow work with single editor (zone positioning uses `afterLineNumber` on the modified content, same as before)

## 5. Cleanup

- [ ] 5.1 Remove `MonacoDiffEditor.vue` component
- [ ] 5.2 Remove DiffEditor-specific CSS from `App.vue` (`.accepted-hunk-decoration`, `.rejected-hunk-decoration`, compound selectors)
- [ ] 5.3 Remove `applyDecisionDecorations()` function and related state from `CodeReviewOverlay.vue`
- [ ] 5.4 Remove ILineChange type imports and `lastLineChanges` ref

## 6. Testing

- [ ] 6.1 Update `src/ui-tests/review-overlay.test.ts` for changed DOM structure (no DiffEditor wrapper, single editor)
- [ ] 6.2 Verify hunk accept removes visual elements and navigates to next pending hunk
- [ ] 6.3 Verify hunk reject reloads file and re-renders remaining hunks at correct positions
- [ ] 6.4 Verify comment zones survive accept/reject operations
- [ ] 6.5 Verify cross-file navigation preserves correct state (hunks + comments load for new file)
- [ ] 6.6 Manual test in WKWebView: verify ViewZone rendering timing, deletion zone heights, colorize() behavior
