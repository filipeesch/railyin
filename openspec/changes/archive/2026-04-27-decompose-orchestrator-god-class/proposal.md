## Why

`src/bun/engine/orchestrator.ts` has grown to 1461 lines housing 7+ distinct responsibilities in a single class — most critically `consumeStream` at ~490 lines and `executeCodeReview` at ~178 lines. Individual behaviours are untestable in isolation, the `AbortController` lifecycle has three inconsistent registration sites, and the dual-constructor overload is a fragile test-injection escape hatch.

## What Changes

- Extract `consumeStream` and its accumulator/flush state into a `StreamProcessor` class that owns the `abortControllers` and `rawMessageSeq` maps
- Replace `_buildExecutionParams` with a pure `ExecutionParamsBuilder` class that accepts a pre-created `AbortSignal` (no side effects)
- Extract `_resolveWorkingDirectory` into a standalone `WorkingDirectoryResolver` class
- Extract each executor method into its own class: `TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, `ChatExecutor`, `CodeReviewExecutor`
- Extract the git diff pipeline inside `executeCodeReview` into a pure `buildDiffCache()` function in `git/git-diff-parser.ts`
- Extract `_getColumnConfig` into a shared utility `src/bun/workflow/column-config.ts`
- Replace the dual-constructor overload on `Orchestrator` with a clean single constructor that accepts an `EngineRegistry` — eliminating the `injectedEngine` escape hatch
- Slim `Orchestrator` down to a ~100-line coordinator that wires the graph and implements `ExecutionCoordinator`

**No logic changes** — this is a pure structural refactoring. All public API surface, the `ExecutionCoordinator` interface, and the `Orchestrator` export are preserved.

## Capabilities

### New Capabilities

- `engine-stream-processor`: Stateful stream consumer responsible for the `consumeStream` loop, accumulator flush logic, `AbortController` lifecycle, and raw model message sequencing
- `engine-execution-params`: Pure builder for `ExecutionParams` and working-directory resolution, shared by all executor modules

### Modified Capabilities

*(none — no spec-level behavioural changes)*

## Impact

- `src/bun/engine/orchestrator.ts` — shrinks to coordinator wiring
- `src/bun/engine/` — new subdirectories `stream/`, `execution/`, `git/`
- `src/bun/workflow/column-config.ts` — new shared utility
- `src/bun/test/orchestrator.test.ts` — must stay green with zero logic changes
- No changes to `src/shared/rpc-types.ts`, `src/bun/engine/coordinator.ts` (interface), or any handler/frontend code
