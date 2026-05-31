## Why

Existing workspace switch tests cover basic session reload (WS-NAV-4/5) and composable unit tests (SS-1..8), but miss critical edge cases that could cause real-world failures:

1. **No board reload on workspace switch** — `boards.list` is called only once at mount. New boards created after app start are invisible until page refresh.
2. **Rapid switching race condition untested** — consecutive workspace clicks before API responses complete could show transient wrong data.
3. **Revisit workspace state untested** — WS-A → WS-B → WS-A round trip doesn't verify WS-A data is restored correctly.
4. **Workspace creation flow incomplete** — creating a new workspace selects it but doesn't verify downstream stores (boards, sessions, models) refresh for the NEW workspace.
5. **WebSocket reconnect during active session untested** — WS drop + reconnect while execution runs may or may not properly restore session state.

These gaps leave potential bugs undetected by the automated test suite.

## What Changes

**New Unit Tests** (`src/mainview/stores/`):
- `workspace.test.ts`: Add WS-SW-* suite testing `selectWorkspace()` triggers all dependent store reloads (sessions, boards).
- `board.test.ts`: Add BP-7/BP-8 scenarios for board auto-selection when switching workspaces.
- `chat.test.ts`: Add C9 scenario for session filter behavior during rapid key changes.

**New E2E Tests** (`e2e/ui/`):
- Extend `board-workspace-nav.spec.ts` with WS-NAV-6 (rapid switch convergence), WS-NAV-7 (revisit workspace state), WS-NAV-8 (workspace creation full flow).
- New spec `e2e/ui/ws-reconnect-session.spec.ts`: WebSocket reconnect during active session restores correct state.

**New Spec Artifacts**:
- `specs/workspace-switch-tests/spec.md`: Requirements covering all new test scenarios.

## Capabilities

### New Capabilities
- `workspace-switch-tests`: Test specifications for workspace switching edge cases — rapid switches, revisit flows, creation flow, WS reconnect timing.

### Modified Capabilities
<!-- No existing spec requirements change — this adds test-only specs -->

## Impact

| Area | Files |
|------|-------|
| New unit test file | `src/mainview/stores/workspace.test.ts` (append WS-SW-* suite) |
| New unit test file | `src/mainview/stores/board.test.ts` (append BP-7/BP-8 scenarios) |
| Extended unit test file | `src/mainview/stores/chat.test.ts` (add C9 cross-workspace rapid switch scenario) |
| New E2E spec file | `e2e/ui/ws-reconnect-session.spec.ts` |
| Extended E2E spec file | `e2e/ui/board-workspace-nav.spec.ts` (add WS-NAV-6/7/8) |
| New spec artifact | `openspec/specs/workspace-switch-tests/spec.md` |
