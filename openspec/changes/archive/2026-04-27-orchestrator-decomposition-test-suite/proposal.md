## Why

The `decompose-orchestrator-god-class` change extracts 7+ responsibilities from a 1461-line class into focused modules (`StreamProcessor`, `EngineRegistry`, `ExecutionParamsBuilder`, `WorkingDirectoryResolver`, 5 executor classes, `git-diff-parser.ts`, `column-config.ts`). Without a dedicated test suite, these new modules are only covered by end-to-end scenarios that go through the full HTTP+DB+Orchestrator stack — making failures hard to diagnose and individual module behavior impossible to assert in isolation.

## What Changes

- **New unit test files** for each extracted pure/near-pure module:
  - `column-config.test.ts` — pure function, zero deps
  - `execution-params-builder.test.ts` — pure `build()` and `buildForChat()` paths
  - `working-directory-resolver.test.ts` — resolver logic in isolation (replaces 5 heavyweight orchestrator integration tests)
  - `engine-registry.test.ts` — factory injection, lazy cache, `cancelAll()` delegation
  - `git-diff-parser.test.ts` — `buildDiffCache()` with a real git fixture
  - `stream-processor.test.ts` — `createSignal()`, `abort()`, `_flushAccumulators()` paths, fatal error handling
- **Updated existing test files** to use `new EngineRegistry(factory)` constructor after the orchestrator refactor:
  - `orchestrator.test.ts` (7 construction sites)
  - `review.test.ts` (1 site)
  - `src/bun/test/support/backend-rpc-runtime.ts` (1 site — powers all stream-pipeline and stream-tree scenarios)
- **Working-directory resolver scenarios** in `orchestrator.test.ts` are kept as integration guards but the resolver logic itself is tested directly in `working-directory-resolver.test.ts`

## Capabilities

### New Capabilities

- `engine-registry-behavior`: Lazy engine creation per workspace key via injected factory; cache semantics; `cancelAll()` delegation to the resolved engine per key
- `stream-processor-lifecycle`: `AbortController` ownership via `createSignal`/`abort`; accumulator flush on all cancel paths (single site); `rawMessageSeq` cleanup in `finally`
- `working-directory-resolver-logic`: All 5 CWD resolution scenarios (worktree ready, monorepo sub-path, outside-git-root error, no worktree, no project-path) tested directly without orchestrator setup

### Modified Capabilities

_(none — no spec-level behavior changes, only test coverage additions)_

## Impact

- `src/bun/test/` — 6 new test files, 3 updated files
- `src/bun/test/support/backend-rpc-runtime.ts` — constructor call updated (1 line change)
- No production code changes; no API or DB schema changes
- All existing tests must remain green after the `decompose-orchestrator-god-class` refactor is applied
