## 1. Unit Tests — workspace store

- [ ] 1.1 Add WS-SW-1: `selectWorkspace()` triggers `chatSessions.list` call with new key
- [ ] 1.2 Add WS-SW-2: `selectWorkspace()` triggers `boards.list` call after config load
- [ ] 1.3 Add WS-SW-3: `selectWorkspace()` persists key AND triggers reloads in sequence (await order)
- [ ] 1.4 Add WS-SW-4: rapid `selectWorkspace()` calls converge — last call's data wins

## 2. Unit Tests — board store

- [ ] 2.1 Add BP-7: `loadBoards("ws-new")` selects first board of target workspace when persisted `activeBoardId` belongs to different workspace
- [ ] 2.2 Add BP-8: `loadBoards(undefined)` retains previously selected board if it still exists in the list

## 3. Unit Tests — chat store extension

- [ ] 3.1 Add C9: `onChatSessionUpdated` handles session arrival during rapid key changes (key changes from "a" → "b" → "c" while event is being processed)

## 4. E2E Tests — workspace navigation (extend existing spec)

- [ ] 4.1 Add WS-NAV-6: Rapid switching convergence test (click 3 tabs within 500ms, verify final state)
- [ ] 4.2 Add WS-NAV-7: Revisit workspace restores sessions and boards (A→B→A round trip)
- [ ] 4.3 Add WS-NAV-8: Workspace creation flow — create new WS via API, select it, verify all stores refreshed

## 5. E2E Tests — WebSocket reconnect (new spec file)

- [ ] 5.1 Create `e2e/ui/ws-reconnect-session.spec.ts`
- [ ] 5.2 Add WS-REC-1: Running session survives WS reconnect (mock WS disconnect/reconnect cycle)
- [ ] 5.3 Add WS-REC-2: Completed/updated session reflected after reconnect
- [ ] 5.4 Add WS-REC-3: No duplicate sessions after reconnect

## 6. Validation

- [ ] 6.1 Run unit tests: `bun test src/mainview/stores/*` — expect FAIL initially (tests validate fix from `fix-chat-session-refresh-on-workspace-switch`)
- [ ] 6.2 After applying fix change, re-run unit tests — expect PASS
- [ ] 6.3 Run E2E tests: `bun run test:e2e` — new tests should pass against fixed implementation
- [ ] 6.4 Verify no regression: all pre-existing tests (C1-C8, SS-1-8, WS-NAV-1-5, etc.) still pass
