## Context

The `fix-board-and-drawer-bugs` change fixes 7 production bugs across `TransitionExecutor`, `StreamProcessor`, and three Vue components. This change adds the regression tests. Because the production fixes use constructor DI (`TaskRepository`, `onTaskUpdated`, `onError`) and a setter (`setOnStreamEvent`), all backend tests can capture real behaviour without module-level mocking.

The Playwright layer uses the established `ApiMock` + `WsMock` fixture pattern. Scroll assertions follow the `evaluate()` pattern already used across PAG and stream-reactivity specs.

## Goals / Non-Goals

**Goals:**
- Cover every bug fix with at least one automated assertion that would have caught the regression before the fix.
- Use dependency injection as the primary seam — no `vi.mock()` module patches for backend tests.
- Use `evaluate(el => el.scrollTop = 0)` as the canonical way to force scroll position in Playwright tests, consistent with existing PAG specs.
- Use `AbortSignal` as the native observer for SP-7/SP-8 — capture the signal before `consume()`, assert `signal.aborted === true` after `await consume()` settles.

**Non-Goals:**
- Changing production code — this is a test-only change.
- Adding tests for the virtualizer internals or ReasoningBubble internal DOM structure beyond the scroll assertion.
- Full mutation testing coverage — that is handled by the separate mutation-testing pipeline.

## Decisions

### D1 — AbortSignal as native observer for error-path tests (SP-7, SP-8)

`createSignal(executionId)` returns the `AbortController.signal` reference, which is a live observer: `signal.aborted` flips synchronously when `controller.abort()` is called. Calling `sp.createSignal(executionId)` before `await sp.consume(...)` gives the test a live handle. After `consume()` settles, asserting `signal.aborted === true` is a zero-overhead, dependency-free check.

This is already the established pattern in SP-1 through SP-4. No custom observer class or factory injection is needed.

### D2 — `setOnStreamEvent` setter injection for `done` event capture (SP-7, SP-8)

`StreamProcessor.setOnStreamEvent(cb)` is a public setter — calling it before `consume()` wires a capturing callback without constructor changes. This follows the same setter-injection pattern used by the Orchestrator in production.

### D3 — `evaluate()` for scroll position in Playwright tests

`page.locator('.conv-body').evaluate(el => el.scrollTop = 0)` is the canonical forced-scroll pattern, already used in PAG-3, PAG-5, PAG-6, PAG-8. All scroll-related regression tests (PAG-9, E-Y, CB-X) use this same mechanism for repeatability.

### D4 — Mid-stream scroll stability checked at multiple checkpoints (E-Y)

Rather than a single post-stream assert, E-Y pushes tokens in three batches and evaluates `scrollTop + clientHeight >= scrollHeight - 40` after each batch. This catches the stutter during streaming, not just at the end. Threshold is 40px to match E-1's tolerance.

### D5 — PAG-9 uses `api.capture` to assert `load-older` fired

After forcing `scrollTop = 0`, PAG-9 uses `api.capture("conversations.getMessages")` to verify that a second load-older request was made. This avoids relying on a fixed `waitForTimeout` and uses the established capture pattern already present in the pagination suite.

## Risks / Trade-offs

- **E-Y scroll stability timing** — Asserting scroll position across three batches assumes each `ws.pushStreamEvent` batch settles between checkpoints. [Risk: false positive if RAF runs too fast] → Use `page.waitForFunction` rather than `evaluate` for each checkpoint, consistent with E-1.
- **SP-9 worktree path assertion** — The test inserts directly into `task_git_context` in the in-memory DB. If the schema changes, the test breaks. [Risk: brittle to schema] → Acceptable; schema changes go through migrations and tests get updated.
- **PAG-9 sentinel visibility** — If the viewport renders the list in a way where the sentinel is not at `scrollTop = 0`, the test will fail spuriously. [Risk: test environment layout] → Use the existing `loadMessages` fixture that produces consistent list heights in the test viewport.
