## Context

The chat console feature is implemented on `task/91-chat-console`. The feature includes `ChatSidebar.vue`, `SessionChatView.vue`, `ConversationDrawer.vue`, `ConversationInput.vue`, and the `useChatStore` / `useDrawerStore` Pinia stores. During implementation, several bugs were found and fixed — but the test suite does not cover any of them. Two selectors in `chat-sidebar.spec.ts` (CS-B-1/2) are silently broken because `.chat-sidebar__new-btn` matches nothing and Playwright doesn't error on `click()` with zero elements in some configurations.

All tests are Playwright e2e using the mock API pattern (`e2e/ui/fixtures/mock-api.ts`), WsMock (`e2e/ui/fixtures/mock-ws.ts`), and mock-data factory functions (`e2e/ui/fixtures/mock-data.ts`). The project does not use Tailwind — CSS is scoped Vue styles.

## Goals / Non-Goals

**Goals:**
- Fix 2 broken selectors in `chat-sidebar.spec.ts`
- Add ~20 new test cases covering: sidebar lifecycle, unread notifications, drawer lifecycle, model selector, boot sequence regressions, and edge cases
- Organize new cases into logical lettered suites appended to existing spec files

**Non-Goals:**
- Visual regression / screenshot tests
- Performance or load testing
- Changing any production code (test-only change)
- Adding new mock API endpoints beyond what's needed for these scenarios

## Decisions

### Test file organization
Append new suites to existing spec files rather than creating new files. Rationale: the existing `chat-sidebar.spec.ts` and `chat-session-drawer.spec.ts` already have a clear suite-per-concern structure (`CS-A`, `CS-B` … `CD-A`, `CD-B`). New suites continue the sequence (`CS-E`, `CS-F`, `CS-G` and `CD-F`, `CD-G`, `CD-H`, `CD-I`).

### Selector strategy for new tests
- PrimeVue Buttons without a custom class: use `aria-label` selector (`button[aria-label='New chat session']`)
- Status states: use `data-status` attribute already added to `SessionChatView` Tag (`[data-status='idle']`)
- Send/cancel: use `data-testid='send-btn'` / `data-testid='cancel-btn'` (already added)
- Model selector: use `.input-model-select` class on the PrimeVue Select wrapper (already present)
- localStorage assertions: use `page.evaluate(() => localStorage.getItem('key'))`

### Sidebar toggle
The sidebar toggle button in `BoardView.vue` is `<Button aria-label="Chat sessions">` with no custom class. Use `button[aria-label='Chat sessions']` in tests.

### Boot sequence tests
Test that sessions and models are populated after page load without any WS push, by checking the DOM after navigation settles. The mock API stubs `chatSessions.list` and `models.listEnabled` — these are already called at boot now.

### Drag-resize test approach
Use `page.mouse.move/down/up` sequence on the `.chat-sidebar__resize-handle` element. Assert `localStorage.getItem('chat-sidebar-width')` changes. Skip pixel-exact width checks (too flaky) — just verify it changed.

## Risks / Trade-offs

- [Timing] Boot sequence tests may be flaky if `loadSessions` / `loadEnabledModels` haven't resolved by the time assertions run → Mitigation: use `waitFor` on a visible session/model item.
- [Outside-click] The drawer outside-click guard filters PrimeVue overlay portals — test must click on a neutral area (e.g. the board backdrop), not on another PrimeVue component.
- [Drag] Drag-resize test coordinates depend on element position, which can shift → Mitigation: use `getBoundingClientRect` via `evaluate` and derive coordinates dynamically.
