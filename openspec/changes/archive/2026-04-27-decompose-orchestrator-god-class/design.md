## Context

`src/bun/engine/orchestrator.ts` is 1461 lines. It is the only implementation of `ExecutionCoordinator` and acts as the runtime hub between RPC handlers and the active `ExecutionEngine`. Over time it absorbed stream processing, git diff parsing, AbortController lifecycle, DB persistence, and working-directory resolution — all in one class. The result is a file that cannot be unit-tested at the method level and that hides three inconsistent `AbortController` registration sites behind a single large method.

Existing patterns in the codebase already show the right shape:
- `translateCopilotStream` is a standalone async generator — callbacks injected as parameters, no class
- `ClaudeEngine` / `CopilotEngine` are injected via `ExecutionEngine` interface
- `CommonToolContext` is the precedent for a named deps-bundle object

The refactoring follows those patterns exactly. No behaviour changes.

## Goals / Non-Goals

**Goals:**
- Extract `consumeStream` (~490 lines) into `StreamProcessor` class — the single owner of `abortControllers` and `rawMessageSeq`
- Replace dual-constructor overload with a clean single constructor accepting `EngineRegistry`
- Make `ExecutionParamsBuilder.build()` a pure function — no `Map` side-effects inside param construction
- Extract each executor method into its own class (`TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, `ChatExecutor`, `CodeReviewExecutor`)
- Isolate the git diff pipeline into a pure `buildDiffCache()` function in `git/git-diff-parser.ts`
- Extract `_getColumnConfig` into `src/bun/workflow/column-config.ts` (used by all executors + `compactTask`)
- `orchestrator.test.ts` stays green with zero changes

**Non-Goals:**
- Changing any observable behaviour (DB writes, event order, error handling)
- Modifying `ExecutionCoordinator` interface or `src/shared/rpc-types.ts`
- Introducing new test files (existing tests are the guard)
- Changing the `ExecutionEngine` interface or any engine implementations

## Decisions

### D1 — StreamProcessor owns both lifecycle maps

**Decision**: `abortControllers` and `rawMessageSeq` move to `StreamProcessor`. It exposes `createSignal(executionId): AbortSignal` and `abort(executionId): void`.

**Why**: Currently `AbortController` is registered in three places (chat inline, `_buildExecutionParams`, `consumeStream` fallback). Centralising registration in `StreamProcessor.createSignal()` reduces it to one site. `Orchestrator.cancel()` delegates abort to `streamProcessor.abort(executionId)` before doing its own DB writes.

**Alternative considered**: Keep maps on `Orchestrator`, pass by reference to `StreamProcessor`. Rejected because it makes the ownership ambiguous and the fallback registration in `consumeStream` (line 929) becomes dead code that's hard to reason about.

---

### D2 — ExecutionParamsBuilder is a stateless class (pure build)

**Decision**: `ExecutionParamsBuilder.build()` accepts a pre-created `AbortSignal` as a parameter. The builder has no state — it could be module-level functions but a class is used for consistency with other executor classes.

**Why**: The current `_buildExecutionParams` creates an `AbortController` internally as a side effect, making params construction non-pure. Passing `signal` in from the caller (after `createSignal()`) eliminates the side effect entirely. `executeChatTurn` currently registers its own controller inline (line 541), bypassing `_buildExecutionParams` — this inconsistency disappears when the builder is pure.

---

### D3 — Constructor injection with individual parameters (not a context bundle)

**Decision**: Each executor class receives its deps individually in the constructor: `new TransitionExecutor(engineRegistry, paramsBuilder, workdirResolver, streamProcessor)`.

**Why**: Deps are few (4–5), stable, and explicit injection makes each executor's requirements self-documenting. A shared context/bundle object was considered but rejected — it would hide which deps each executor actually needs and make the graph harder to understand at a glance.

---

### D4 — EngineRegistry replaces injectedEngine escape hatch

**Decision**: Extract `getEngineForWorkspace` + the `engines` Map into a standalone `EngineRegistry` class. Tests construct `EngineRegistry` with a `TestEngine` and inject it — eliminating the dual-constructor overload.

**Why**: The current overload checks `"execute" in engineOrOnError` at runtime, which is fragile. `EngineRegistry` is the natural seam: tests replace the registry, not the orchestrator constructor.

---

### D5 — git-diff-parser.ts is a pure async function, not a class

**Decision**: `buildDiffCache(worktreePath: string, filePaths: string[]): Promise<DiffCache>` exported from `src/bun/engine/git/git-diff-parser.ts`.

**Why**: The diff pipeline has no lifecycle state. A pure function is independently testable with a real git fixture and has no DI surface area. `CodeReviewExecutor` imports it directly.

---

### D6 — column-config.ts utility in workflow/

**Decision**: Extract `_getColumnConfig` to `src/bun/workflow/column-config.ts` as `getColumnConfig(config, boardId, columnId)`.

**Why**: It's called by all 4 task executors and `compactTask` on `Orchestrator`. It has no instance state. The `workflow/` directory already holds peer utilities (`review.ts`, `slash-prompt.ts`).

## Risks / Trade-offs

- **Risk**: `consumeStream` has subtle accumulator-flush ordering that is easy to break during extraction. → **Mitigation**: Extract as-is first, add no logic changes, run `orchestrator.test.ts` + full suite before every commit.
- **Risk**: `StreamProcessor` cross-calls `onTaskUpdated` / `onNewMessage` / `onToken` / `onStreamEvent` which are provided as constructor callbacks. If a callback type changes upstream, `StreamProcessor`'s constructor signature must also change. → **Mitigation**: Keep callback types as the existing `OnToken`, `OnError`, `OnTaskUpdated`, `OnNewMessage`, `OnStreamEvent` aliases from `types.ts` — no new types introduced.
- **Risk**: `cancel()` on `Orchestrator` must still call `engine.cancel(executionId)` on all engines — that knowledge lives on `Orchestrator` / `EngineRegistry`, not `StreamProcessor`. The split means `cancel()` does two things: `streamProcessor.abort()` + `engineRegistry.cancelAll(executionId)`. This is slightly more complex to read. → **Mitigation**: Keep `cancel()` on `Orchestrator` and document the two-step clearly.
- **Trade-off**: Five new small files vs one large file. Navigation is easier but there are more import paths to maintain. Accepted — each file is now independently readable and testable.
