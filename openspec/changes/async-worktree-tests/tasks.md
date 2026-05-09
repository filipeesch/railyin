## 1. Unit tests — `prepareAndExecute()` callback behavior

- [ ] 1.1 Write `worktree-preparation.test.ts` — callback success path
- [ ] 1.2 Callback: failure case (worktree creation threw → onFailed)
- [ ] 1.3 Concurrent calls — verify single worktree creation (idempotency)
- [ ] 1.4 Already-ready worktree → no-op, returns immediately
- [ ] 1.5 Server restart — in-flight preparation recovers
- [ ] 1.6 Task deletion during preparation → cancels in-flight work
- [ ] 1.7 Timeout protection — `"preparing"` → `"failed"` after configurable timeout

## 2. Integration tests — Handler behavior with async worktree

- [ ] 2.1 tasks.transition — RPC returns immediately (≤1s) while in `"preparing"`
- [ ] 2.2 tasks.retry — same async return (≤1s) while in `"preparing"`
- [ ] 2.3 Worktree success → auto-triggers execution, starts streaming
- [ ] 2.4 Worktree failure → task becomes `"failed"`, error shown
- [ ] 2.5 WebSocket push carries correct state throughout (`"preparing"` → `"running"`)
- [ ] 2.6 State machine transitions work correctly (`preparing` → `running` / `failed`)

## 3. E2E UI — Playwright `async-worktree-preparation` spec

- [ ] 3.1 Drag task to column with `on_enter_prompt` → shows `"preparing"` badge
- [ ] 3.2 `"preparing"` badge → `"running"` transition
- [ ] 3.3 Worktree creates successfully → UI updates badge
- [ ] 3.4 Worktree fails → error badge shown
- [ ] 3.5 Retry cycle works (retry → preparation → streaming)
- [ ] 3.6 Deleted task during preparation → cancelled gracefully
- [ ] 3.7 Mock `ApiMock` for `"preparing"` state in `e2e/ui/fixtures/mock-api.ts`
- [ ] 3.8 WebSocket push event simulation for `"preparing"` → `"running"` → `"failed"`
