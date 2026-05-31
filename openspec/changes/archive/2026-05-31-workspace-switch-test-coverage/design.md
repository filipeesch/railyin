## Context

Current test coverage for workspace switching:

```
Unit Tests (src/mainview/stores/):
  workspace.test.ts: WS-P-1..4 — persistence, key selection ✅
  chat.test.ts:      C1-C6 — unread logic; C7a-c — workspace filter; C8a-c — loadSessions idempotency ✅
  useSessionSyncHandler.test.ts: SS-1..8 — composable unit tests ✅
  board.test.ts:     SU-1..3, SD-1..5, BP-1..6 — CRUD + persistence ✅

E2E Tests (e2e/ui/):
  board-workspace-nav.spec.ts: WS-NAV-1..5 — tab classes, config calls, localStorage, session reload ✅
```

**Gaps identified:**
- No unit test verifies `selectWorkspace()` triggers downstream store reloads (sessions, boards).
- No E2E test covers rapid consecutive workspace switches or revisit flows.
- No E2E test covers workspace creation flow end-to-end (create → select → verify all stores refreshed).
- No E2E test covers WebSocket reconnect timing with active sessions.
- Board store has no scenario testing auto-selection when `activeBoardId` belongs to a different workspace.

## Goals / Non-Goals

**Goals:**
- Fill every gap identified above with concrete test cases.
- Use DI-based mocking (`vi.fn()`) rather than alternative code paths for testability.
- Follow existing test naming conventions (WS-SW-* for workspace switch, WS-NAV-* for E2E nav).
- Ensure each spec scenario maps to exactly one test case (1:1 traceability).

**Non-Goals:**
- Changing production code behavior (tests must pass against current implementation; new prod changes are handled by `fix-chat-session-refresh-on-workspace-switch`).
- Writing integration tests that require a real Bun server (all tests use mocked API).
- Adding mutation testing or coverage tools (out of scope).

## Decisions

### Decision 1: Use dependency injection via mock factories for store tests
**Choice:** Create test helper functions that instantiate stores with pre-configured `apiMock`, enabling deterministic assertions without global state leakage.

```typescript
// Test pattern:
const apiMock = vi.fn(async (method) => { /* returns method-specific data */ });
vi.mock("../rpc", () => ({ api: (...args) => apiMock(...args) }));

beforeEach(() => {
  setActivePinia(createPinia());
  apiMock.mockReset();
});

it("WS-SW-1: selectWorkspace loads sessions and boards", async () => {
  const store = useWorkspaceStore();
  await store.selectWorkspace("ws-new");
  
  expect(apiMock).toHaveBeenCalledWith("workspace.getConfig", { workspaceKey: "ws-new" });
  // After fix: expect(apiMock).toHaveBeenCalledWith("chatSessions.list", { workspaceKey: "ws-new" });
});
```

**Rationale:** This is already the established pattern in `workspace.test.ts`, `board.test.ts`, and `useSessionSyncHandler.test.ts`. Following it ensures consistency.

**Alternatives considered:**
- *Real Pinia instance with injected dependencies*: More robust but requires changing store constructors. Overkill for unit tests that only call public actions.
- *Component-level Vue Testing Library tests*: Would test full UI rendering. Not needed for store action assertions.

### Decision 2: E2E tests use `api.capture()` for request verification
**Choice:** Use the existing `ApiMock.capture()` pattern from `board-workspace-nav.spec.ts` to verify API calls during workspace switch scenarios.

```typescript
test("WS-NAV-6: rapid switching converges to correct final state", async ({ page, api }) => {
  const sessionCalls = api.capture("chatSessions.list", []);
  
  // Rapidly click three workspace tabs
  await page.locator(".workspace-tab").nth(0).click();
  await page.locator(".workspace-tab").nth(1).click();
  await page.locator(".workspace-tab").nth(2).click();
  
  // Final state should show ws-3 sessions
  await expect.poll(() => sessionCalls.length).toBeGreaterThanOrEqual(1);
  const lastCall = sessionCalls[sessionCalls.length - 1];
  expect(lastCall.workspaceKey).toBe("ws-3");
});
```

**Rationale:** `api.capture()` gives us full control over which requests to track and can be asserted after the fact. Already proven in WS-NAV-4.

### Decision 3: Revisit workspace test reuses existing fixture data
**Choice:** The WS-NAV-7 revisit test should reuse the same two workspaces/fixtures as WS-NAV-1 through WS-NAV-5 rather than creating new fixture infrastructure.

**Rationale:** Reduces test maintenance burden and keeps all workspace nav tests in a single file where they share fixtures and setup code.

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| E2E tests flakily fail due to `nextTick` timing | Medium | Use `expect.poll()` instead of fixed `waitForTimeout()` delays. This is already the pattern in WS-NAV-2/WS-NAV-4. |
| New unit tests expose uncaught bugs in current codebase | Low (but desired) | If `selectWorkspace()` doesn't trigger downstream reloads (current bug), tests will FAIL — this is the intended behavior. Fix first, then enable tests. |
| Test suite growth makes CI slower | Low | Only 5 new unit tests + 4 new E2E tests. Negligible impact on total run time (<1s added). |

## Migration Plan

1. Create spec file `specs/workspace-switch-tests/spec.md` with all requirements.
2. Implement unit tests in existing `.test.ts` files (append suites).
3. Implement E2E tests (extend existing specs + create new reconnect spec).
4. Run full test suite to verify no regressions.
5. All tests should FAIL initially if `fix-chat-session-refresh-on-workspace-switch` hasn't been applied yet (this validates correctness).

No rollback needed — adding tests never breaks production.

## Open Questions

- Should the `ws-reconnect-session` E2E test simulate actual WS disconnection? Current Playwright fixture mocks WS at the API layer only. May need a separate spike for realistic WS simulation.
