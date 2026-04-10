## Context

The code review overlay currently renders a Monaco DiffEditor with a fixed 520px height, configured in `renderSideBySide: true` mode and `vs-dark` theme. Below the editor, a separate scrollable list of hunk action bars maps decisions to hunks by index. This creates a spatial disconnect: the developer must look at the hunk number in the bar, find the matching highlighted region in the editor, make a decision, and return to the bar — a back-and-forth that compounds for files with many hunks.

The target UX: Monaco fills the full overlay height, and each hunk's Accept / Reject / Change Request controls appear inline, injected directly into the editor after the last changed line — the same pattern GitHub uses for PR review.

## Goals / Non-Goals

**Goals:**
- Monaco editor fills the full diff-panel area (flex, not fixed px)
- Default inline (unified) diff mode; header toggle for side-by-side
- Light `vs` theme to match app styling
- Hunk action bars rendered as Monaco ViewZone DOM widgets inline after each hunk's last line
- Accept and Reject collapse the diff for that hunk (display model patching)
- Change Request leaves the diff visible with the zone in a "decided" visual state
- Comment textarea always visible in zone; required only for Change Request
- Prev/Next hunk navigation in the header with a pending-hunk counter
- Content-hash correlation to accurately place ViewZones even after line shifts from already-decided hunks

**Non-Goals:**
- Real-time collaboration or multi-reviewer support
- Modifying the backend hunk-decision persistence mechanism (SHA-256 hash, `task_hunk_decisions` table)
- Changing the Submit / `code_review` message flow
- IntelliSense or editing capabilities within the review editor

## Decisions

### Decision 1: Inline (unified) mode as default, with toggle

**Chosen**: `renderSideBySide: false` (inline) as default. A header toggle switches to `renderSideBySide: true`.

**Why**: ViewZone injection is significantly simpler in inline mode. In inline mode there is a single editor pane; `editor.getModifiedEditor()` returns the unified editor and `changeViewZones` works directly. In side-by-side mode, ViewZones must be mirrored across both the original and modified panes — inserting one in the modified pane without a matching invisible spacer in the original pane causes the panes to de-sync vertically. Inline mode eliminates this entirely.

**Alternative**: Side-by-side only. Rejected because it requires double ViewZone management (one visible + one spacer per hunk) and doesn't match the GitHub analogy the design is targeting.

**Side-by-side impl plan**: When the toggle switches to side-by-side, ViewZones are placed in `editor.getModifiedEditor()` with matching invisible spacer zones in `editor.getOriginalEditor()`. The spacer zone's `heightInPx` matches the action zone's height. Both zones are tracked in the same hunk record and removed together on decision.

### Decision 2: Display model patching for diff collapse

**Chosen**: On Accept or Reject, we maintain a mutable "display model" (separate from the API-returned `original`/`modified` strings). We patch the relevant line range, then call `editor.setModel()` with the patched content. Monaco recomputes the diff — the decided hunk region is now identical on both sides and disappears.

- **Accept**: Replace the display `original` in the hunk's original line range with the corresponding `modified` lines. Both sides now show the modified version.
- **Reject**: Replace the display `modified` in the hunk's modified line range with the corresponding `original` lines. Both sides now show the original version.

**Why**: This is the simplest approach for collapse — no custom decorations, no special renderer logic. Monaco naturally hides unchanged regions.

**Alternative**: Hide the hunk via a Monaco `deltaDecorations` overlay or a collapsible fold region. Rejected — folds only work on single panes and leave line numbers intact, which is confusing.

**Trade-off**: Re-calling `editor.setModel()` after each decision causes a full diff recomputation. For large files this is acceptable since it happens on user action (not in a hot loop). We debounce rapid consecutive decisions by 100ms.

### Decision 3: Content-based ViewZone correlation (not line-number-based)

**Chosen**: After applying all decided-hunk patches to build the display model, we ask Monaco for `editor.getLineChanges()`. We then match each `ILineChange` to an API hunk by comparing the actual line content at the change range against the stored `originalLines` and `modifiedLines` from the API hunk record.

**Why**: Line numbers shift when prior hunks are patched. A hunk originally at line 30 may be at line 28 after a two-line deletion above it was accepted. The SHA-256 hash (identity key) is content-based and survives this, but the line number in the API response becomes stale for ViewZone placement. Content matching gives accurate placement after arbitrary shift.

**Implementation detail**:
```
For each ILineChange from Monaco:
  Extract the raw text lines at [originalStart..originalEnd] from display original
  Extract the raw text lines at [modifiedStart..modifiedEnd] from display modified
  Find API hunk where hunk.originalLines ≈ those original lines AND hunk.modifiedLines ≈ those modified lines
  → Place ViewZone after ILineChange.modifiedEndLineNumber
```

**Edge case**: Two hunks with identical changed content (extremely rare). Fallback: match by closest line distance.

### Decision 4: HunkActionBar as a Vue component mounted into ViewZone DOM nodes

**Chosen**: Create `HunkActionBar.vue`. For each hunk ViewZone, allocate a raw `<div>` (the ViewZone's `domNode`), then call `createApp(HunkActionBar, props).mount(domNode)`. The app instance is tracked on the hunk record for teardown.

**Why**: The action bar has reactive state (button highlighted states, comment textarea, validation). Re-rendering it as static HTML would be complex. Vue's `createApp` pattern is the established way to mount components into non-Vue-managed DOM.

**Trade-off**: Keyboard events inside the ViewZone's DOM will be captured by Monaco's key handler unless stopped. All `keydown` events on the action bar's container must call `e.stopPropagation()` to prevent Monaco from intercepting them (especially for the textarea).

### Decision 5: ViewZone height management for the comment textarea

**Chosen**: The ViewZone initial height is fixed at ~80px (buttons + one-line textarea). When the textarea grows (auto-resize), we call `accessor.layoutZone(zoneId)` inside a `ResizeObserver` on the ViewZone's DOM node to update Monaco's line-offset accounting.

**Trade-off**: `ResizeObserver` adds a small overhead per hunk. Acceptable since the number of hunks per file is typically single-digit.

### Decision 6: Two modes retained, simplified

The existing Changes / Review mode distinction is kept but simplified:
- **Changes mode**: ViewZone shows decision badge (read-only) — no interactive buttons
- **Review mode**: ViewZone shows full interactive action bar

This preserves the intent of the current design (open overlay → verify state → consciously enter review) while embedding the controls inline.

## Risks / Trade-offs

- **Re-model on every decision**: `editor.setModel()` disposes the old model and creates a new one. Existing ViewZones are destroyed. We must re-inject all remaining pending ViewZones after each model swap. → Mitigation: collect all undecided hunks' ViewZone data before calling `setModel`, then re-insert them all in a single `changeViewZones` call after model is set.

- **Side-by-side spacer sync**: If window resizes change ActionBar height while in side-by-side mode, the original pane's spacer may get out of sync. → Mitigation: `ResizeObserver` on the zone drives `layoutZone` on both the modified zone and the original spacer in the same callback.

- **Monaco keyboard capture**: IME, arrow keys, and Escape inside the ViewZone textarea will be partially captured by Monaco. → Mitigation: `stopPropagation` on the container's `keydown/keyup/keypress`. Tested pattern; works in Monaco ≥0.34.

- **`createApp` teardown**: If the overlay is closed mid-review, all mounted Vue app instances must be unmounted before the Monaco editor is disposed, otherwise memory leaks. → Mitigation: track all app instances in an array; call `app.unmount()` in the `onBeforeUnmount` hook of `MonacoDiffEditor.vue`.

## Open Questions

- None — all decisions locked based on exploration.
