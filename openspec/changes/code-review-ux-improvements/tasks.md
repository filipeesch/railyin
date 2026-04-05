## 1. MonacoDiffEditor Component Overhaul

- [x] 1.1 Remove fixed `height` prop and replace with class-based flex sizing (`height: 100%`)
- [x] 1.2 Change Monaco theme from `vs-dark` to `vs`
- [x] 1.3 Change default `renderSideBySide` to `false` (inline mode)
- [x] 1.4 Expose the raw Monaco editor instance (via `defineExpose`) so the parent overlay can call `changeViewZones`, `getModifiedEditor`, `revealLineInCenter`, etc.
- [x] 1.5 Track all mounted HunkActionBar Vue app instances in an internal array; call `app.unmount()` on each in `onBeforeUnmount` before disposing the editor
- [x] 1.6 Accept an `onSideBySide` prop / emit a `viewModeChange` event so the parent can drive the toggle without remounting the editor

## 2. HunkActionBar Component (new)

- [x] 2.1 Create `src/mainview/components/HunkActionBar.vue` with props: `hunk: HunkWithDecisions`, `mode: 'changes' | 'review'`, and callbacks `onDecide(hash, decision, comment)`
- [x] 2.2 In Changes mode: render the decision as a read-only badge (accepted / rejected / change_request / pending)
- [x] 2.3 In Review mode: render Accept / Reject / Change Request buttons with active-highlight on current decision
- [x] 2.4 Always render the comment textarea below the buttons; mark it required (red border + message) only when Change Request is the active decision and textarea is empty
- [x] 2.5 Add a `Save` button that appears when comment has content and decision is not yet saved
- [x] 2.6 Attach `stopPropagation` to `keydown`, `keyup`, and `keypress` on the component root to isolate from Monaco keyboard capture
- [x] 2.7 Emit `heightChange` when the textarea auto-resizes (drives `layoutZone` in parent)

## 3. ViewZone Lifecycle in CodeReviewOverlay

- [x] 3.1 Build the "display model" on diff load: start from API `original`/`modified`, apply all already-decided hunks (accept patches original, reject patches modified)
- [x] 3.2 After `MonacoDiffEditor` emits `hunksReady` (ILineChange[]), run content-based correlation to map each ILineChange to its API hunk record (match line text, fallback to closest-line distance)
- [x] 3.3 For each undecided hunk: allocate a `<div>` domNode, mount `HunkActionBar` via `createApp`, then call `editor.getModifiedEditor().changeViewZones(accessor => accessor.addZone({ afterLineNumber, heightInPx, domNode }))` — store the zone ID and app instance on the hunk record
- [x] 3.4 On `heightChange` event from HunkActionBar, call `editor.getModifiedEditor().changeViewZones(accessor => accessor.layoutZone(zoneId))` to sync Monaco's line offsets
- [x] 3.5 Implement `onDecide(hash, decision, comment)`: save to DB via `electroview.tasks.setHunkDecision`, apply optimistic update to store, call `rejectHunk` for rejected decisions, then trigger display model patch + model swap
- [x] 3.6 After model swap: remove all stale ViewZones, re-run correlation against Monaco's new `getLineChanges()`, re-inject ViewZones for all remaining undecided hunks in a single `changeViewZones` call
- [x] 3.7 For Change Request: do NOT patch the display model; remove the pending ViewZone and re-inject it in "decided" visual state (pass `mode='changes'` equivalent props to HunkActionBar)
- [x] 3.8 Wire `ResizeObserver` fallback per zone on the domNode as an alternative to the `heightChange` event (handles cases where textarea resize happens without Vue reactivity)

## 4. Side-by-Side ViewZone Mirroring

- [x] 4.1 When in side-by-side mode, add an invisible spacer ViewZone in `editor.getOriginalEditor()` with matching `heightInPx` for each action zone added to the modified editor
- [x] 4.2 Store spacer zone IDs alongside action zone IDs per hunk
- [x] 4.3 On `layoutZone` for the action zone, also call `layoutZone` for the corresponding spacer zone with the same height

## 5. Navigation Controls

- [x] 5.1 Add `currentHunkIdx` and `pendingHunks` (computed list of undecided hunk records in current file) to review store or local overlay state
- [x] 5.2 Add Prev / Next buttons and a "N pending" counter to the overlay header
- [x] 5.3 Prev / Next call `editor.getModifiedEditor().revealLineInCenter(hunk.viewZoneAfterLine)` and update `currentHunkIdx`
- [x] 5.4 Add a brief CSS highlight animation on the target ViewZone's domNode when navigating to it (add/remove a class with a 600ms fade)
- [x] 5.5 Decrement pending counter on Accept, Reject, and Change Request decisions

## 6. Inline / Side-by-Side Toggle

- [x] 6.1 Add a toggle button in the overlay header (e.g., "⇔ Side by side" / "≡ Inline")
- [x] 6.2 On toggle: call Monaco's `updateOptions({ renderSideBySide: true/false })` (does not require model swap)
- [x] 6.3 After toggle, re-run ViewZone injection (existing zones are invalidated by the layout change); for side-by-side, also inject spacer zones in original editor
- [x] 6.4 Store toggle state in local overlay ref (not persisted across sessions)

## 7. Overlay Layout

- [x] 7.1 Remove fixed `diffEditorHeight = 520` constant from `CodeReviewOverlay.vue`
- [x] 7.2 Make `review-overlay__diff-panel` a flex column with `flex: 1; min-height: 0` so it fills available space
- [x] 7.3 Make `monaco-diff-editor` CSS class use `height: 100%` instead of inline `height: Npx`
- [x] 7.4 Remove the `hunk-action-list` DOM block below the editor (replaced entirely by ViewZones)
- [x] 7.5 Move the Submit Review button to a fixed bottom-right position within the overlay (outside the diff panel)

## 8. Specs Sync

- [ ] 8.1 Run `/opsx:sync-specs` after implementation to merge delta specs into main specs
