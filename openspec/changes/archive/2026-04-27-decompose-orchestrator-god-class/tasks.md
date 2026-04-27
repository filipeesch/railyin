## 1. Workflow utility extraction

- [x] 1.1 Create `src/bun/workflow/column-config.ts` exporting `getColumnConfig(config, boardId, columnId)` — pure function extracted from `Orchestrator._getColumnConfig`
- [x] 1.2 Replace all call sites in `orchestrator.ts` (`compactTask`, `compactConversation`, and the four task executors) with imports from the new utility

## 2. Git diff parser extraction

- [x] 2.1 Create `src/bun/engine/git/git-diff-parser.ts` with `buildDiffCache(worktreePath, filePaths): Promise<DiffCache>` — pure async function extracted from the inline loop inside `executeCodeReview`
- [x] 2.2 Define and export the `DiffCache` type (map of filePath → diff string + SHA) in the same file

## 3. ExecutionParamsBuilder and WorkingDirectoryResolver

- [x] 3.1 Create `src/bun/engine/execution/execution-params-builder.ts` with `ExecutionParamsBuilder` class — `build()` accepts `AbortSignal` as parameter (no AbortController side-effects)
- [x] 3.2 Create `src/bun/engine/execution/working-directory-resolver.ts` with `WorkingDirectoryResolver` class — wraps worktree + monorepo sub-path resolution logic from `_resolveWorkingDirectory`
- [x] 3.3 Ensure `ExecutionParamsBuilder.build()` has a separate `buildForChat()` path for chat executions (no taskId, boardId, or taskContext)

## 4. EngineRegistry

- [x] 4.1 Create `src/bun/engine/engine-registry.ts` with `EngineRegistry` class holding `engines: Map<string, ExecutionEngine>` and `getEngine(workspaceKey)` / `cancelAll(executionId)` methods
- [x] 4.2 In `EngineRegistry`, expose a way to inject a fixed engine for testing (e.g. `EngineRegistry.fromFixed(engine)` static constructor) — eliminates the dual-constructor overload in `Orchestrator`

## 5. StreamProcessor

- [x] 5.1 Create `src/bun/engine/stream/stream-processor.ts` with `StreamProcessor` class owning `abortControllers` and `rawMessageSeq` maps
- [x] 5.2 Implement `createSignal(executionId: number): AbortSignal` that creates and registers a new `AbortController`
- [x] 5.3 Implement `abort(executionId: number): void` for external cancellation (called by `Orchestrator.cancel()`)
- [x] 5.4 Extract `_runNonNative` into `StreamProcessor.runNonNative(taskId, conversationId, executionId, engine, params, callbacks)` — drives the engine and calls `consume()`
- [x] 5.5 Extract `consumeStream` event loop into `StreamProcessor.consume()` — all token accumulation, reasoning state machine, tool event routing, human-turn detection, done/cancel/error handling
- [x] 5.6 Extract the three cancel-flush duplications into a single private `_flushAccumulators()` helper on `StreamProcessor`
- [x] 5.7 Delete `_emitFileDiffFromWrittenFiles` from the main class and move it as a private method on `StreamProcessor` (retains `taskId: number` — no null path)

## 6. Executor classes

- [x] 6.1 Create `src/bun/engine/execution/transition-executor.ts` with `TransitionExecutor` class — constructor receives `(engineRegistry, paramsBuilder, workdirResolver, streamProcessor)`; exposes `execute(task, triggerData, workflowConfig)` extracted from `executeTransition`
- [x] 6.2 Create `src/bun/engine/execution/human-turn-executor.ts` with `HumanTurnExecutor` class — same constructor shape; exposes `execute(executionId, task, message, attachments?)`  extracted from `executeHumanTurn`
- [x] 6.3 Create `src/bun/engine/execution/retry-executor.ts` with `RetryExecutor` class — exposes `execute(executionId, task)` extracted from `executeRetry`
- [x] 6.4 Create `src/bun/engine/execution/chat-executor.ts` with `ChatExecutor` class — exposes `execute(conversationId, prompt, context)` extracted from `executeChatTurn`; uses `streamProcessor.createSignal()` + `paramsBuilder.buildForChat()` (fixes inline AbortController registration inconsistency from line 541)
- [x] 6.5 Create `src/bun/engine/execution/code-review-executor.ts` with `CodeReviewExecutor` class — imports `buildDiffCache` from `git-diff-parser.ts`; exposes `execute(task, reviewConfig)` extracted from `executeCodeReview`

## 7. Orchestrator slim-down

- [x] 7.1 Refactor `Orchestrator` constructor to a single signature accepting `EngineRegistry` — remove the dual-constructor overload (`"execute" in engineOrOnError` check)
- [x] 7.2 Instantiate all extracted classes inside `Orchestrator` constructor and wire them together
- [x] 7.3 Replace inline `executeTransition` / `executeHumanTurn` / `executeRetry` / `executeChatTurn` / `executeCodeReview` bodies with one-liner delegations to the corresponding executor's `execute()` method
- [x] 7.4 Replace `cancel()` body with `streamProcessor.abort(executionId)` + `engineRegistry.cancelAll(executionId)` + DB writes
- [x] 7.5 Remove all extracted private helpers from `Orchestrator` (`_buildExecutionParams`, `_resolveWorkingDirectory`, `_getColumnConfig`, `_runNonNative`, `consumeStream`, `_emitFileDiffFromWrittenFiles`, `_persistRawModelMessage`, `_appendPromptMessage`)

## 8. Test compatibility

- [x] 8.1 Update `src/bun/test/orchestrator.test.ts` constructor call-sites: replace `new Orchestrator(testEngine, ...)` with `new Orchestrator(EngineRegistry.fromFixed(testEngine), ...)` — zero logic changes
- [x] 8.2 Run `bun test src/bun/test/orchestrator.test.ts --timeout 20000` and confirm all tests pass

## 9. Final verification

- [x] 9.1 Run the full backend suite `bun test src/bun/test --timeout 20000` and confirm no regressions
- [x] 9.2 Run `bun run build` to confirm TypeScript compilation is clean across all new modules
