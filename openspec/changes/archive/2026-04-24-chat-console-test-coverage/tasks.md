## 1. Fix Broken Selectors

- [x] 1.1 Fix CS-B-1/B-2 selectors: replace `.chat-sidebar__new-btn, button[data-action='new-chat']` with `button[aria-label='New chat session']` in `chat-sidebar.spec.ts`

## 2. Sidebar Lifecycle Tests (CS-E)

- [x] 2.1 Add CS-E-1: sidebar auto-opens when session becomes active (WS push + select)
- [x] 2.2 Add CS-E-2: active session item has `is-active` class; others do not
- [x] 2.3 Add CS-E-3: archived session is hidden from sidebar list
- [x] 2.4 Add CS-E-4: sidebar width persists in localStorage after drag-resize

## 3. Sidebar Drag-Resize Tests (CS-G)

- [x] 3.1 Add CS-G-1: drag resize handle left increases sidebar width and updates localStorage
- [x] 3.2 Add CS-G-2: width is clamped at min (160px) and max (400px)

## 4. Unread Notification Tests (CS-F)

- [x] 4.1 Add CS-F-1: `chatSessions.markRead` is called when a session is opened
- [x] 4.2 Add CS-F-2: unread dot disappears after opening the session
- [x] 4.3 Add CS-F-3: active session does NOT get unread dot from WS push

## 5. Drawer Lifecycle Tests (CD-F)

- [x] 5.1 Add CD-F-1: clicking outside the drawer panel closes it
- [x] 5.2 Add CD-F-2: loading spinner (`.scv-loading`) is visible while messages load
- [x] 5.3 Add CD-F-3: closing drawer removes `is-active` from all session items

## 6. Model Selector Tests (CD-G)

- [x] 6.1 Add CD-G-1: model dropdown contains populated options after page boot
- [x] 6.2 Add CD-G-2: selecting a model from the dropdown updates the selection

## 7. Boot Sequence Regression Tests (CD-H)

- [x] 7.1 Add CD-H-1: sessions appear in sidebar after page load without any WS push
- [x] 7.2 Add CD-H-2: model dropdown options are available after page load (no manual trigger needed)

## 8. Edge Case Tests (CD-I)

- [x] 8.1 Add CD-I-1: saving blank rename input does not call `chatSessions.rename` API
- [x] 8.2 Add CD-I-2: duplicate WS `chatSession.updated` event does not create duplicate sidebar items
- [x] 8.3 Add CD-I-3: creating a new session while one is open replaces the drawer content
