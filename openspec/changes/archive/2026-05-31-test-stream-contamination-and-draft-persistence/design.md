## Context

The `fix-stream-contamination-and-draft-persistence` change modifies `conversationStore`, `taskStore`, adds `draftStore`, and touches `ConversationInput.vue`. None of these new code paths have test coverage. The test infrastructure already supports everything needed — Vitest with Pinia for unit tests, Playwright with `WsMock`/`ApiMock` for E2E — so this is purely about writing tests, not about changing testability.

Two existing tests (`SB-5`, `SB-9` in `conversation.test.ts`) assert the old behavior (non-active `streamStates` entry retained as a cleared shell). They will fail after the fix. They must be updated to assert the new correct behavior.

## Goals / Non-Goals

**Goals:**
- Cover the stream contamination fix at unit level (sendMessage guard, drainQueue guard)
- Cover streamStates memory fix at unit level and provide a regression guard
- Cover draftStore lifecycle at unit level (get/set/clear, TTL eviction, key isolation)
- Cover draft persistence at E2E level (tab switch, drawer reopen, reload, send-clears, cross-task isolation)
- Cover queue-drain contamination at E2E level (SS-3)
- Update SB-5 and SB-9 to reflect post-fix correct behavior

**Non-Goals:**
- Testing backend behavior (no backend changes)
- Testing `submitDecisions` separately from `sendMessage` (same guard, no marginal value)
- Playwright coverage for `deleteTask`/`archiveSession` → `draftStore.clear` (store wiring, not user-visible behavior)
- Mutation testing or coverage tooling changes

## Decisions

**SB-5 / SB-9 update direction** — Change assertion from `expect(state).toBeDefined()` to `expect(store.streamStates.get(conversationId)).toBeUndefined()`. The spec changed; these tests must reflect the new spec, not the old behavior.

**drainQueue unit test via public API** — `taskQueues` and `enqueueMessage` are both exported from `taskStore`. Use `enqueueMessage(bgTaskId, ...)` + `onTaskUpdated({ ...bgTask, executionState: "completed" })` to trigger a drain without reaching into store internals.

**localStorage in Vitest** — `jsdom` (the current test environment) provides a working `localStorage`. Use `localStorage.clear()` in `beforeEach` in `draft.test.ts`. No `vi.stubGlobal` needed unless there's interference; verify during implementation.

**Playwright localStorage seeding** — Follow the pattern from `board-selection-persistence.spec.ts`: use `page.evaluate(() => localStorage.setItem(...))` to pre-seed drafts before `page.goto()`, and `page.evaluate(() => localStorage.getItem(...))` to read back persisted values.

**SS-3 test structure** — Use two tasks: `taskA` (active, idle) and `taskB` (running with enqueued message). Push `task.updated` for taskB transitioning to `completed` after opening taskA's drawer. Assert no messages in taskA's view and no stream content visible. The `api.handle("tasks.sendMessage")` mock must return a valid message for taskB's conversationId so the drain doesn't error.

**conversation-draft.spec.ts fixture** — Reuse `makeTask`, `openTaskDrawer`, `makeChatSession`, `openSessionDrawer` from existing fixtures. Use `typeInEditor` helper from `queue-messages.spec.ts` (`.task-detail__input .cm-content`) for task input and `.session-chat-view .cm-content` for session input.

## Risks / Trade-offs

**SB-5/SB-9 update timing** — These tests will start failing as soon as the `streamStates.delete()` change lands. They must be updated in the same commit as the production fix (or in the same PR), not after.

**draft.test.ts localStorage isolation** — If Vitest runs test files in the same jsdom context, stale localStorage from one test can bleed into another. Mitigate with `localStorage.clear()` in `beforeEach`.

**SS-3 async drain timing** — The drain fires asynchronously after `task.updated`. Use `await page.waitForTimeout` sparingly; prefer `await expect(...).not.toBeVisible()` with a timeout to avoid flakiness.
