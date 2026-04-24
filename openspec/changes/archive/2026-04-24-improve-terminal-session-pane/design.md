## Context

The board view renders the terminal as a bottom dock composed of `TerminalPanel.vue`, `PtyTerminal.vue`, and `TerminalSessionList.vue`. The panel already supports height resizing through a horizontal top-edge handle, but the session list is fixed at 200px and only hints at overflow through native `overflow-y: auto`, which is easy to miss in the dark theme and on overlay-scrollbar platforms.

This change is intentionally scoped to the terminal session pane rather than the terminal output area or footer. The UX direction is already settled: add a vertical divider for resizing the session list width, keep the divider subtle at rest with strong hover feedback, style the native scrollbar, and persist the chosen width per browser profile.

## Goals / Non-Goals

**Goals:**
- Allow users to resize the terminal session list width between 160px and 400px.
- Persist the session list width locally so it survives reloads in the current browser profile.
- Make overflow in the terminal session list visually discoverable while preserving native scrolling behavior.
- Reuse established resize-handle patterns already used in the chat sidebar and conversation drawer.

**Non-Goals:**
- Changing terminal panel height behavior or replacing its existing resize handle.
- Introducing a custom scrollbar implementation or non-native scrolling behavior.
- Redesigning terminal session metadata, footer behavior, or PTY connection logic.

## Decisions

### Store terminal session pane width with terminal UI state
Persist the session list width alongside existing terminal UI preferences instead of keeping it as ephemeral component-local state. This keeps terminal layout preferences in one domain and matches the current use of local storage for panel height, open state, and active session.

**Alternatives considered**
- Keep width state only in `TerminalPanel.vue`: simpler wiring, but splits terminal layout persistence across files and makes reuse harder.
- Store per workspace: more contextual, but unnecessary for this UX change and inconsistent with the current terminal height persistence model.

### Put the vertical resize handle in `TerminalPanel.vue`
`TerminalPanel.vue` owns the split layout between terminal output and session list, so it should own the draggable divider and width coordination. `TerminalSessionList.vue` should stay focused on rendering sessions and scrolling behavior while receiving width through props or store state.

**Alternatives considered**
- Put resize logic inside `TerminalSessionList.vue`: reduces parent logic, but couples a child component to parent layout boundaries.
- Make the divider a separate shared component: reusable, but heavier than needed for a single, already-localized split view.

### Keep the divider subtle at rest with a wider hit target and strong hover/drag state
The divider should read as a separator first and an affordance on interaction, consistent with the rest of the app’s docked panels. A visually quiet resting state plus a slightly wider interactive hit area balances discoverability and low visual noise.

**Alternatives considered**
- Always-prominent handle: easier to discover, but adds persistent chrome in a dense terminal surface.
- Invisible hit area only: cleaner, but likely repeats the current discoverability problem.

### Style the native scrollbar instead of replacing it
The list already scrolls correctly with native browser behavior. Styling the native scrollbar and related edge treatment improves discoverability without taking on the complexity and fragility of a custom scrollbar.

**Alternatives considered**
- Custom scrollbar component: more visual control, but unnecessary complexity and higher cross-browser risk.
- Leave scrollbar fully default: simplest, but does not address the current “hidden overflow” complaint.

## Risks / Trade-offs

- **Drag conflicts with text selection or terminal interaction** -> Keep the divider outside the terminal content region, use the same mousemove/mouseup pattern as existing resize handles, and prevent default on drag start.
- **Overly narrow or wide session panes harming readability** -> Clamp the width to 160px–400px and preserve terminal output as the primary area.
- **Scrollbar styling differing by platform/browser** -> Use lightweight native scrollbar styling and treat it as progressive enhancement rather than requiring pixel-perfect parity.
- **State duplication between store and component** -> Centralize persisted width in the terminal store or a single terminal-owned storage path and keep consumers read-only.
