## 1. Disable SDK Threshold Auto-Compaction

- [x] 1.1 In `getOrCreateSession()`, change `SettingsManager.inMemory({ compaction: { enabled: false, reserveTokens: 16_384, keepRecentTokens: 20_000 } })` and add a comment explaining that threshold compaction is managed by the `turn_end` handler

## 2. Track SDK Overflow Retry Signal

- [x] 2.1 Add `const sdkWillRetryRef = { value: false }` inside `createManagedExecution()`, after `const errorRef`
- [x] 2.2 In the `session.subscribe()` callback, add a branch: when `event.type === "compaction_end" && !event.aborted && (event as any).willRetry`, set `sdkWillRetryRef.value = true`

## 3. Extract `runWithCompactionResume()` Helper

- [x] 3.1 Add a new private method `runWithCompactionResume(session, resolvedPrompt, conversationId, queue, errorRef, sdkWillRetryRef, providerName, signal)` to `PiEngine`
- [x] 3.2 Implement the while-loop body: first iteration calls `runWithLimiter(() => session.prompt(resolvedPrompt))`; subsequent iterations call `runWithLimiter(() => session.agent.continue())`
- [x] 3.3 After each `runWithLimiter` call, check `sdkWillRetryRef.value`: if true, reset it to false, call `await this.waitForNextAgentEnd(session)`, and `continue` the loop
- [x] 3.4 After the SDK retry check, read `bgCompactions.get(conversationId)`: if a promise exists, `await` it, then check `session.agent.state.messages.at(-1)?.role`; if `!== "assistant"` then `continue`, else `break`
- [x] 3.5 If neither sdkWillRetry nor bgCompaction applies, `break` (normal completion)

## 4. Add `waitForNextAgentEnd()` Helper

- [x] 4.1 Add a new private method `waitForNextAgentEnd(session: AgentSession): Promise<void>` that subscribes to the session, resolves on the first `agent_end` event, and immediately unsubscribes

## 5. Update `runPromptWithCompaction()`

- [x] 5.1 Replace the current body of `runPromptWithCompaction()` with a call to `this.runWithCompactionResume(...)`, keeping `.catch(err => errorRef.error = ...)` and `.finally(() => queue.close())` on the returned promise
- [x] 5.2 Add `sdkWillRetryRef` to the `runPromptWithCompaction` signature and thread it through from the call site in `createManagedExecution()`

## 6. Wire `sdkWillRetryRef` at Call Site

- [x] 6.1 In `createManagedExecution()`, pass `sdkWillRetryRef` to `runPromptWithCompaction()`

## 7. Add `isContextOverflow` Import

- [x] 7.1 Add `isContextOverflow` to the existing `@earendil-works/pi-ai` import in `engine.ts` (needed for inline guard in step 3.4 edge case: overflow error message reappearing after bg compaction)

## 8. Add `MockResumingSession` Test Utility

- [x] 8.1 Create `MockResumingSession` in `src/bun/test/pi/compaction-resume.test.ts` (or a shared support file if reused): same session factory shape as `MockBgSession`; adds `continueCallCount`, `agent.continue()` spy, `abortMidTurn` flag for `prompt()`, and `willRetry` emit support in `subscribe()`

## 9. New Test File: `compaction-resume.test.ts`

- [x] 9.1 **CR-1**: BG compaction fires → `prompt()` resolves early → queue stays open → `agent.continue()` called; assert `continueCallCount === 1` and no premature `done` event
- [x] 9.2 **CR-2**: Last message `role: "assistant"` after BG compaction → `agent.continue()` NOT called, loop breaks; assert `continueCallCount === 0`
- [x] 9.3 **CR-3**: Two consecutive turns both exceed threshold → two compactions → two `continue()` calls; assert `compactCallCount === 2`, `continueCallCount === 2`
- [x] 9.4 **CR-4**: `agent.continue()` throws → error propagated via `errorRef`; assert `errorRef.error` set, queue closed, no unhandled rejection
- [x] 9.5 **CR-5**: `agent.continue()` wrapped in `runWithLimiter`; mock registry; assert acquire/release called around `continue()`
- [x] 9.6 **CR-6**: `compaction_end { willRetry: true }` → `sdkWillRetryRef.value = true` → loop awaits `waitForNextAgentEnd`, does NOT call `agent.continue()` itself; assert `continueCallCount === 0`
- [x] 9.7 **CR-7**: `compaction_end { willRetry: false }` → treated as normal completion; assert `sdkWillRetryRef.value === false`, loop breaks

## 10. Extend `background-compaction.test.ts`

- [x] 10.1 **BC-6**: BG compaction fires mid-execution → `AsyncQueue` not closed prematurely; collect all events via `for await`, assert no `done` event until after `continueCallCount === 1`
- [x] 10.2 **BC-7**: Token count drops below threshold on second turn → no second compaction triggered; assert `compactCallCount === 1` across two turns
