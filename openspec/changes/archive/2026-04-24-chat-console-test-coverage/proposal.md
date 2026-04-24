## Why

The chat console feature (standalone AI chat sessions) was implemented in branch `task/91-chat-console` but the Playwright test suite has significant gaps: 20+ missing test scenarios, 2 broken selectors (`CS-B-1/2`) that silently pass because no element is found, and zero regression coverage for bugs we already fixed (sessions lost on refresh, void RPC crash, model list not loading). Without these tests, future regressions will go undetected.

## What Changes

- Fix broken test selectors in `chat-sidebar.spec.ts` (CS-B-1/2: `.chat-sidebar__new-btn` → `button[aria-label='New chat session']`)
- Add **CS-E** suite: sidebar lifecycle (auto-open, active highlight, archived hidden, width persistence)
- Add **CS-F** suite: unread notification lifecycle (markRead on open, dot cleared on open, not marked for active session)
- Add **CD-F** suite: drawer lifecycle (outside-click close, loading spinner, session close clears state)
- Add **CD-G** suite: model selector (options populated on boot, model change updates selection)
- Add **CD-H** suite: boot sequence regression (sessions load on page load, models load on page load)
- Add **CD-I** suite: edge cases (empty rename guard, dedup WS events, creating session while another is open)
- Add **CS-G** suite: sidebar drag-resize (width changes, localStorage persistence)

## Capabilities

### New Capabilities

- `chat-console-e2e-coverage`: Playwright test coverage for chat console feature — sidebar lifecycle, drawer behavior, unread notifications, model loading, boot sequence, and edge cases.

### Modified Capabilities

*(none — no existing spec-level requirements are changing, only test coverage)*

## Impact

- **Test files changed**: `e2e/ui/chat-sidebar.spec.ts`, `e2e/ui/chat-session-drawer.spec.ts`
- **No production code changes** — this is test-only
- **Mock API additions**: may need new stubs for `chatSessions.markRead` response, model list validation
- **WsMock additions**: helpers for unread notification scenarios already exist (`pushChatSessionUpdated`)
