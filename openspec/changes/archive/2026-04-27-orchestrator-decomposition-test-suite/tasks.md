## 1. Constructor migration (prerequisite for all new tests)

- [x] 1.1 Update `src/bun/test/support/backend-rpc-runtime.ts`: replace `new Orchestrator(engine, ...)` with `new Orchestrator(new EngineRegistry(() => engine), ...)`
- [x] 1.2 Update `src/bun/test/review.test.ts`: replace `new Orchestrator(new NoopEngine(), ...)` with `new Orchestrator(new EngineRegistry(() => new NoopEngine()), ...)`
- [x] 1.3 Update all 7 `new Orchestrator(...)` construction sites in `src/bun/test/orchestrator.test.ts` to use `new EngineRegistry(factory)` constructor
- [x] 1.4 Update the 2 production construction sites in `src/bun/index.ts`: replace dual-constructor pattern with `const engine = injectedEngine ?? resolveEngine(config, ...); const registry = new EngineRegistry(() => engine); new Orchestrator(registry, ...)`
- [x] 1.5 Run `bun test src/bun/test --timeout 20000` and confirm all existing tests pass

## 2. Unit tests — pure modules

- [x] 2.1 Create `src/bun/test/column-config.test.ts`: test `getColumnConfig(config, boardId, columnId)` — found, missing board, missing column (3 cases)
- [x] 2.2 Create `src/bun/test/execution-params-builder.test.ts`: test `build()` passes signal through without creating AbortController; `buildForChat()` sets `taskId: null`; `enabled_mcp_tools` JSON parse; task context populated from task row (4 cases)
- [x] 2.3 Create `src/bun/test/engine-registry.test.ts`: factory called once per key (cache); separate factory call per distinct key; `cancelAll()` delegates `cancel(id)` to cached engine; `cancelAll()` is no-op for unknown key (4 cases)
- [x] 2.4 Create `src/bun/test/git-diff-parser.test.ts`: `buildDiffCache()` returns diff for modified tracked file; returns empty string for untracked file; SHA-256 is deterministic for same content; handles binary file gracefully (4 cases, uses real git fixture via `mkdtempSync` + `execSync`)

## 3. Working-directory resolver unit tests

- [x] 3.1 Create `src/bun/test/working-directory-resolver.test.ts` with all 5 scenarios: worktree ready single-repo; worktree ready monorepo sub-path; project_path outside gitRootPath throws; no worktree falls back to project_path; no project_path configured falls back to worktree_path
- [x] 3.2 Remove the 5 `CapturingEngine`/`makeCapturingOrchestrator` working-directory tests from `src/bun/test/orchestrator.test.ts` (they are replaced by 3.1 — the orchestrator integration tests for `executeHumanTurn` already cover the delegation path)

## 4. StreamProcessor focused integration tests

- [x] 4.1 Create `src/bun/test/stream-processor.test.ts` with `ScriptedEngine` + in-memory DB harness (no HTTP handlers, no `BackendRpcRuntime`)
- [x] 4.2 SP-1: `createSignal(id)` → `abort(id)` fires the returned `AbortSignal`
- [x] 4.3 SP-2: `abortControllers` and `rawMessageSeq` entries deleted in `finally` (both success and cancel paths)
- [x] 4.4 SP-3: Token content flushed to DB as `assistant` message on cancel mid-stream (use `scriptCheckpoint` to pause, assert DB empty, abort, assert DB has message)
- [x] 4.5 SP-4: Reasoning content flushed to DB as `reasoning` message on cancel mid-stream
- [x] 4.6 SP-5: `{ type: "error", fatal: true }` → execution `status = "failed"` + task `execution_state = "failed"` in DB

## 5. Final verification

- [x] 5.1 Run `bun test src/bun/test --timeout 20000` — full suite green, no regressions
- [x] 5.2 Run `bun run build` — clean TypeScript compilation across all new test files
