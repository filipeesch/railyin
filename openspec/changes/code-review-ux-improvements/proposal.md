## Why

The current code review overlay renders a fixed-height Monaco diff editor above a separate scrollable list of hunk action bars. This disconnects the decision controls from the code they describe, forcing the reviewer to mentally map hunk numbers to locations in the editor. The UX should feel like GitHub — decisions happen inline, directly beneath the changed lines.

## What Changes

- Monaco DiffEditor expands to fill the full overlay height (flexbox, no fixed px)
- Default mode switches from side-by-side to **inline (unified)** diff, with a toggle to switch back
- Monaco theme changes from `vs-dark` to `vs` (light, matching app styling)
- Hunk action bars are removed from below the editor and replaced with **ViewZone widgets** — DOM nodes injected directly into Monaco after the last line of each hunk
- Each ViewZone widget shows: Accept / Reject / Change Request buttons + always-visible comment textarea
- Comment is optional for Accept and Reject; **required** for Change Request
- **Accept**: patches the display model (modified wins), ViewZone removed — diff collapses
- **Reject**: patches the display model (original wins), ViewZone removed — diff collapses
- **Change Request**: diff stays visible, ViewZone transitions to a "submitted" visual state; neither side wins; comment sent to model at submit
- Header gains **Prev / Next hunk navigation** buttons with a live pending-hunk counter
- Decisions are persisted by content-hash (SHA-256) and survive line shifts between re-loads
- ViewZone correlation with API hunks is done by **content matching** (not line number) to remain stable after decided hunks shift line offsets

## Capabilities

### New Capabilities
- `code-review-viewzones`: Inline ViewZone-based hunk action widgets rendered inside Monaco

### Modified Capabilities
- `code-review`: Major UX overhaul — layout, theme, mode defaults, diff collapse behavior, navigation, and comment model all change

## Impact

- `src/mainview/components/CodeReviewOverlay.vue` — restructured layout, ViewZone lifecycle management, display-model patching logic, navigation state
- `src/mainview/components/MonacoDiffEditor.vue` — theme, default renderSideBySide, expose editor instance for ViewZone access, remove fixed height
- New component `src/mainview/components/HunkActionBar.vue` — mounted into ViewZone DOM nodes via `createApp`
- `src/mainview/stores/review.ts` — add navigation state (currentHunkIndex, pendingCount)
- `openspec/specs/code-review/spec.md` — requirements updated for new layout, theme, modes, and decision behaviors
