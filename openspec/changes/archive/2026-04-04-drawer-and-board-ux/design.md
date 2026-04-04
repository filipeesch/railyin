## Context

The app uses PrimeVue 4 with a right-side `<Drawer>` component (`TaskDetailDrawer.vue`) for task detail. The drawer renders with `:modal="false"` (no backdrop) but PrimeVue's built-in outside-click detection is still active and uses a simple DOM containment check against the Drawer's root element. PrimeVue teleports overlay panels (Select dropdowns, Dialog backdrops) to `document.body`, outside the Drawer subtree — these trigger the outside-click guard erroniously, closing the drawer mid-interaction.

The board (`BoardView.vue`) used the HTML5 Drag-and-Drop API. On Linux (CEF/GTK), `effectAllowed`/`dropEffect` do not reliably override the OS-level cursor — the forbidden cursor (∅) persisted regardless of handler placement.

## Goals / Non-Goals

**Goals:**
- Fix the three broken actions caused by the overlay-dismiss bug (delete, save-edit, model change)
- Keep true outside-clicks (clicking the board or sidebar) closing the drawer as before
- Default drawer width at 70% of viewport width; reset to 70% when the drawer closes
- Contextual send/cancel button in the input row
- Model selector below the textarea
- Move cursor (not forbidden) during task drag; no text selection during drag
- Visual column highlight indicating active drop target during drag

**Non-Goals:**
- Persisting drawer width across sessions
- Expand/collapse toggle for the drawer
- Supporting touch/mobile drag-and-drop

## Decisions

### Decision 1: Disable PrimeVue's outside-click and implement a custom guard

**Decision**: Set `dismissable` prop to `false` on the PrimeVue Drawer, then attach a `mousedown` listener on `document` that closes the drawer manually when appropriate.

**Rationale**: PrimeVue's built-in check is a simple `!drawerEl.contains(event.target)`. We need richer logic:
1. Is the click target inside an active PrimeVue overlay? → PrimeVue adds `p-overlay-open` class to `document.body` when any overlay is active. Check `document.body.classList.contains('p-overlay-open')`.
2. Is an internal dialog open (`editDialogVisible` or `deleteDialogVisible`)? → Check the ref values.
3. Otherwise → close.

**Alternatives considered**:
- `@outside-click` event on Drawer — not available in PrimeVue 4 Drawer
- Teleporting dialogs inside the Drawer DOM — would require breaking the PrimeVue Dialog component's teleport target, fragile
- Using `:pt` passthrough to remove the outside-click listener — undocumented, brittle across PrimeVue patch versions

### Decision 2: Viewport-relative default width, computed once at mount

**Decision**: `const drawerWidth = ref(Math.round(window.innerWidth * 0.7))` — computed once when the component is set up. The width is reset to this same value in `onHide` so the drawer always opens fresh at 70% after being closed.

**Rationale**: Electron's window is typically not resized during a session. Computing once keeps the code simple. Resetting on close is cheap and avoids accumulating state across sessions without persistence.

### Decision 3: Send/Cancel button is a single context-aware slot

**Decision**: Replace the static send button with a conditional:
- `executionState !== 'running'` → `pi-send` icon, `@click="send"`, disabled when textarea is empty
- `executionState === 'running'` → `pi-stop-circle` icon, `@click="cancel"`, always enabled

The Cancel entry in the side panel is removed; it is now surfaced only in the input row.

**Rationale**: The input row is always visible and in the user's focus. The side panel Cancel was buried below other metadata and required scrolling on narrow configurations.

### Decision 4: Model selector placed below the textarea

**Decision**: The model `<Select>` moves from the side panel's metadata section into the input area, rendered in a row below the textarea+button row. The side panel entry is removed.

**Rationale**: The model is a per-message setting, not a static task property. Proximity to the textarea makes the affordance clearer.

### Decision 5: Drag-and-drop via pointer events

**Decision**: Replace the HTML5 Drag-and-Drop API entirely with pointer events (`pointerdown`, `pointermove`, `pointerup`). On `pointerdown`, `userSelect: none` is applied immediately to prevent text selection. After a 5px movement threshold, a text ghost element follows the cursor, `document.body.style.cursor = 'grabbing'` is set, and the hovered column is highlighted. On `pointerup`, the task transitions to the target column if different from its current state, and the ghost and cursor are cleaned up.

**Rationale**: On Linux, Electrobun uses CEF (libcef.so) backed by GTK. GTK takes over cursor management via the X11/Wayland DnD protocol when a native HTML5 drag is active. `dropEffect = 'move'` is communicated to the browser engine but the OS-level cursor shows `no-drop` (∅) regardless of handler placement or `effectAllowed` values. Pointer events bypass the native DnD protocol entirely, keeping cursor control in CSS and JavaScript.

**Alternatives considered**:
- `effectAllowed = 'move'` + `dropEffect = 'move'` — tried first, did not solve the Linux cursor issue
- Document-level `dragover` listener — tried as broader coverage, same root cause persists
- `cursor: grab` CSS on task cards — has no effect once an HTML5 drag is active (OS protocol takes over)

### Decision 6: Card clone as drag ghost, original card hidden in place

**Decision**: On drag activation, clone the source card element with `cloneNode(true)`, set it `position: fixed` at the grab-offset position relative to the cursor, and set `opacity: 0` on the original element. The ghost has a slight `rotate(1.5deg)` transform and elevated `box-shadow` to signal it is "lifted". On `pointerup`, the ghost is removed and the source opacity is restored.

**Rationale**: Cloning the actual element means the ghost inherits all card styles (title, badge, execution state colour) automatically — no duplication of rendering logic. Keeping the original in place at `opacity: 0` preserves column layout and prevents other cards from jumping up mid-drag. The grab offset is captured on `pointerdown` so the card doesn't snap to the cursor tip but stays exactly where the user grabbed it.

### Decision 7: Column drop target highlighted with dashed outline

**Decision**: Track the column under the pointer during drag via `elementFromPoint` (hiding the ghost first to avoid interference). Set `dragOverColumnId` ref to the matching column's id. Bound to `:class="{ 'is-drag-over': dragOverColumnId === column.id }"` with `outline: 2px dashed` CSS.

**Rationale**: Gives clear visual feedback about where the card will be dropped without requiring HTML5 drop events.

## Risks / Trade-offs

- **`p-overlay-open` is internal to PrimeVue** — If PrimeVue changes this class name in a future version, the overlay guard breaks silently. Mitigation: add a comment in the code noting the PrimeVue version dependency (`^4.x`), and the tests will catch regressions if overlays start closing the drawer again.
- **`window.innerWidth` at setup time** — If the user opens TaskDetailDrawer for the first time after resizing the Electron window, the 70% default could be recalculated. Trade-off accepted (simple code vs. perfect accuracy).
- **Cancel previously in side panel** — Removing it from the side panel may briefly confuse users who relied on it there. Trade-off: the input-row cancel is more discoverable and consistent.
- **Pointer events and accessibility** — Native drag-and-drop has some screen reader support; pointer events do not. Accepted as a trade-off for the Linux CEF cursor fix; can be revisited if accessibility becomes a priority.
- **Ghost element z-index** — Set to `9999`; could conflict with PrimeVue overlay panels (Dialog, etc.) if those are elevated above that value. Unlikely in practice during a drag gesture.

## Migration Plan

All changes are frontend-only, no DB migrations or backend changes required. Deployment is a standard app build/update.
