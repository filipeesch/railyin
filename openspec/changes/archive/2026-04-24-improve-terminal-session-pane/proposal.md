## Why

The terminal panel already supports resizing its overall height, but the session list remains fixed-width and its overflow behavior is easy to miss. As terminal usage grows, users need clearer control over the session pane and more obvious access to off-screen sessions.

## What Changes

- Add a resizable vertical divider between terminal output and the terminal session list.
- Persist the terminal session list width in the browser profile so the layout remains stable across reloads.
- Style the native scrollbar in the terminal session list so overflow is visible and usable in the dark terminal theme.
- Preserve the existing terminal panel height resize behavior while improving the session list pane only.

## Capabilities

### New Capabilities
- `terminal-session-pane`: Controls terminal session list resizing, persisted pane width, and visible scrolling behavior within the terminal panel.

### Modified Capabilities
- None.

## Impact

- Affected UI components: `src/mainview/components/TerminalPanel.vue`, `src/mainview/components/TerminalSessionList.vue`
- Affected state: `src/mainview/stores/terminal.ts` or local panel persistence for session list width
- Affected tests: terminal/session panel UI coverage in `e2e/ui/board.spec.ts` or a dedicated terminal-focused UI spec
