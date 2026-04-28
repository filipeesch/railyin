## Context

The board Playwright suite (`e2e/ui/board.spec.ts`) is a 719-line monolith covering ~21 of 46 spec scenarios. The existing tests use a solid mock infrastructure (ApiMock + WsMock) with a `dist/` + `vite preview` approach — no Bun server needed. The gap analysis identified 25 missing scenarios and 2 confirmed bugs with no regression coverage.

**Current board test architecture:**
```
e2e/ui/
  board.spec.ts          (719 lines, 8 suites — all concerns mixed)
  fixtures/
    index.ts             (base test + auto-use api/ws/task fixtures)
    mock-api.ts          (ApiMock: page.route interceptor)
    mock-ws.ts           (WsMock: page.routeWebSocket interceptor)
    mock-data.ts         (factory fns: makeTask, makeBoard, makeWorkspace, makeProject, etc.)
```

**Known gaps by cluster:**
- DnD (6 scenarios): pointer-event lifecycle, ghost DOM, capacity block, error revert
- Unread state (4): WS push → dot visible, clear on select
- Workspace nav (2): multi-tab, tab switch reloads boards
- Task creation (3): form submit, validation, card appears
- Capacity (5): badge, error display, limit=null fallback
- WS reactivity bugs (2+): agent create_task never shows card; execution state badge stuck after `waiting_user`

**Bug root causes confirmed:**
- `execCreateTask` (board-tools.ts) inserts task in DB but never calls `onTaskUpdated` → no `task.updated` broadcast → board never learns about the new task
- `execMoveTask` calls `ctx.onTransition()` which is a no-op in both Claude and Copilot engine adapters → moved task never broadcast
- `_pauseExecution` (stream-processor.ts) updates DB to `waiting_user` but doesn't call `this.onTaskUpdated()` → badge stays "running"

## Goals / Non-Goals

**Goals:**
- Add ~28 new Playwright tests closing the identified gaps against existing board/column specs
- Establish shared DnD helper utilities to keep drag tests readable and maintainable
- Add `setupBoardWithTemplate()` fixture factory to eliminate the G-* suite code smell
- Add `test.fail()` spec-gap markers for DND-8 (revert on error), WS-3 (agent create_task), and PB-1 (project badge) — these document unimplemented behaviours
- Split `board.spec.ts` into focused files so each concern can be read and debugged independently

**Non-Goals:**
- Fixing the confirmed backend bugs (`execCreateTask`/`execMoveTask` broadcast, `_pauseExecution`) — tracked separately
- Implementing the missing `TaskCard.vue` project badge — tracked separately
- Adding backend unit tests or Bun API tests

## Decisions

### D1: Focused spec files over one growing monolith

**Decision:** Split new tests across `board-dnd.spec.ts`, `board-unread.spec.ts`, `board-workspace-nav.spec.ts`, `board-create-task.spec.ts`, `board-capacity.spec.ts`, `board-ws-updates.spec.ts`, and `board-project-badge.spec.ts`. Do not merge into existing `board.spec.ts`.

**Rationale:** The existing file is already 719 lines with 8 concerns mixed. Adding 28 more cases would exceed ~1000 lines and make failures hard to locate. Separate files allow `npx playwright test e2e/ui/board-dnd.spec.ts` to run just the DnD cluster in isolation.

**Alternative considered:** Add suite blocks to the existing file. Rejected — doesn't solve readability or targeted-run ergonomics.

---

### D2: Shared DnD helpers in `fixtures/board-helpers.ts`

**Decision:** Extract `navigateToBoard()` from the existing local helper in `board.spec.ts` and add `startDragOnCard()` / `dragCardToColumn()` / `assertGhostInDom()` to `e2e/ui/fixtures/board-helpers.ts`. Not added to `fixtures/index.ts` auto-use fixtures — imported explicitly.

**Rationale:** DnD tests require dispatching native `PointerEvent`s via `page.evaluate`, which is multi-step and verbose. A shared helper keeps each test's intent visible. `fixtures/index.ts` is for always-on fixtures (api, ws, task); DnD helpers are opt-in.

**Alternative considered:** Inline evaluate in each test. Rejected — 8 tests × ~15 lines of pointer event boilerplate = 120 lines of noise.

---

### D3: `setupBoardWithTemplate()` in mock-data.ts

**Decision:** Add a `setupBoardWithTemplate(api: ApiMock, template: WorkflowTemplate): void` helper to `e2e/ui/fixtures/mock-data.ts` that calls `api.returns("boards.list", [...]).returns("workspace.getConfig", makeWorkspace({ workflows: [template] }))`. Use it in the G-* suite refactor.

**Rationale:** The G-* suite repeats a 20-line inline workspace+template object 4–5 times. `makeWorkspace()` already exists and is unused in that suite. One helper collapses ~80 lines of duplication.

---

### D4: `test.fail()` for unimplemented spec gaps

**Decision:** Use Playwright's `test.fail()` (not `test.skip()`) for DND-8, WS-3, and PB-1 scenarios.

**Rationale:** `test.fail()` marks the test as an expected failure and flips pass/fail: it passes when the assertion fails (bug still present) and fails when the assertion succeeds (bug is fixed → reminder to remove the marker). `test.skip()` would hide the gap entirely. These three tests are spec coverage, not bug fixes.

---

### D5: WS-reactivity bug tests assert store state via DOM, not API mocks

**Decision:** For Bug 1 (execution state badge) and Bug 2 (agent task creation), drive state entirely through `ws.push({ type: "task.updated", payload: {...} })` and assert DOM classes/elements. No `page.reload()`.

**Rationale:** The entire point of these tests is to verify that the WS→store→DOM reactive path works without a page refresh. Using `page.reload()` would hide the bug entirely.

## Risks / Trade-offs

- **DnD pointer events in headless CI** → Playwright's `page.evaluate` `PointerEvent` dispatch is reliable in headless Chromium. The ghost clone relies on `cloneNode` appended to `document.body`; `page.evaluate(() => document.body.children.length)` is the assertion strategy. Risk: low.
- **`test.fail()` tests invert pass/fail semantics** → A developer who fixes a bug will see a "failing" test until they remove the `test.fail()` marker. This is intentional but requires a code comment explaining the pattern.
- **G-* suite refactor** → Behaviorally equivalent — swaps inline object for `makeWorkspace()` factory. Risk: `makeWorkspace()` defaults must match the existing hardcoded values. Needs diff review.
- **WS-3 (`task.created` board update) is a confirmed missing broadcast** — the `test.fail()` test will pass (assertion fails = bug present) until `execCreateTask` is patched to call `onTaskUpdated`.
