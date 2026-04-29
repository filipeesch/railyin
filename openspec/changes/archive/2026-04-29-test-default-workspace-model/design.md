## Context

The `fix-default-workspace-model` change introduces `resolveTaskModel()`, seeds `task.model` at creation, and adds `engine.model` fallback to three executors. None of these code paths have existing dedicated test coverage. `HumanTurnExecutor` and `RetryExecutor` have no test files at all. The `tasks.create` handler has integration tests in `handlers.test.ts` but none that exercise `engine.model` seeding. `TransitionExecutor` has a test file with good DI infrastructure that can be extended.

The test strategy uses three layers:
1. **Unit** — pure function tests for `resolveTaskModel()`, no DB or config
2. **Integration** — in-memory DB tests using existing DI stubs and `setupTestConfig`
3. **Playwright E2E** — one UI test verifying the seeded model appears in the chat drawer

## Goals / Non-Goals

**Goals:**

- Cover all code paths introduced by `fix-default-workspace-model` with automated tests.
- Reuse the existing DI stub pattern from `transition-executor.test.ts` for new executor test files.
- Extend `setupTestConfig` with an `engineModel` option (no breaking changes to existing callers).
- Validate the `||` (empty-string-as-not-set) semantics of `resolveTaskModel`.
- Cover the `HumanTurnExecutor` engine-lost fallback path (the waiting_user → resume throws path).

**Non-Goals:**

- No new production code changes (this change only touches test files and `helpers.ts`).
- No performance tests.
- No mutation testing configuration.
- No tests for `ChatExecutor` or `board-tools.ts` (already correct, no changes made there).

## Decisions

### D1: Reuse DI stubs from `transition-executor.test.ts`

**Decision:** `CapturingParamsBuilder`, `StubStreamProcessor`, `StubWorkdirResolver`, and `TestEngine` are already defined inline in `transition-executor.test.ts`. For the new `human-turn-executor.test.ts` and `retry-executor.test.ts` files, duplicate these stubs locally rather than extracting to a shared helpers file.

**Rationale:** Extraction would require modifying `helpers.ts` in a non-trivial way and could affect existing test imports. The stubs are small, self-contained, and the DRY benefit is low given only 3 test files use them. If a shared extraction becomes warranted later, it can be done independently.

**Alternative considered:** Extract stubs to `src/bun/test/executor-stubs.ts`. Rejected for now — premature extraction adds surface area to the test helpers file and this change already modifies `helpers.ts`.

### D2: Extend `setupTestConfig` with `engineModel?: string | null`

**Decision:** Add an optional `engineModel` field to the `SetupTestConfigOptions` type (or the existing parameter signature). Default is `"copilot/mock-model"` (preserving existing behavior). Pass `null` to omit the `model:` line from the YAML entirely.

```ts
// Before (conceptual):
setupTestConfig(extraYaml?: string, gitRootPath?: string, extraWorkflows?: string[])

// After:
interface SetupTestConfigOptions {
  extraYaml?: string;
  gitRootPath?: string;
  extraWorkflows?: string[];
  engineModel?: string | null; // undefined = "copilot/mock-model", null = omit line
}
setupTestConfig(opts?: SetupTestConfigOptions)
// OR: add as 4th positional param (match existing style of helpers.ts)
```

Both callers using the existing positional signature remain unaffected. The implementation only adds the `model:` line when `engineModel !== null`.

**Alternative considered:** Pass `extraYaml` that overrides the engine block entirely. Rejected — YAML last-key-wins is fragile and hard to read; an explicit option is clearer.

### D3: `HumanTurnExecutor` engine-lost path via `TestEngine.throwOnResume`

**Decision:** Add a `throwOnResume?: boolean` constructor option to the local `TestEngine` stub in `human-turn-executor.test.ts`. When `true`, `engine.resume()` throws, triggering the fallback path in `HumanTurnExecutor` where it starts a fresh execution instead.

```ts
class TestEngine implements ExecutionEngine {
  constructor(private opts: { throwOnResume?: boolean } = {}) {}
  async resume(_id: number): Promise<void> {
    if (this.opts.throwOnResume) throw new Error("session lost");
  }
  async *execute(): AsyncIterable<EngineEvent> { yield { type: "done" }; }
}
```

This is the minimal DI needed to reach the engine-lost code path without mocking internals.

### D4: Playwright test scope — one test only

**Decision:** Add a single Playwright test (Q-20) to `extended-chat.spec.ts` suite Q that verifies: when `workspace.engine.model` is configured and `tasks.create` returns a task, the model selector in the chat drawer shows the engine-seeded model.

The mock setup already has `makeWorkspace({ engine: { type: "copilot", model: "copilot/gpt-4.1" } })` — the test uses `api.capture("tasks.create", makeTask({ model: "copilot/gpt-4.1" }))` to simulate the seeded task and verifies the selector value.

**Rationale:** The priority chain and DB logic are fully covered by integration tests. The Playwright test validates only the UI renders correctly — the minimal signal needed to confirm the frontend path works.

## Risks / Trade-offs

- **Stub duplication risk** — If the executor DI interfaces change, three test files will need updating instead of one. Acceptable trade-off given the stubs are small and stable.
- **`setupTestConfig` signature change** — Adding the `engineModel` param could be done as a 4th positional param (matching existing style) or as an options object. Must not break any existing callers that pass 1–3 positional args.
- **`HumanTurnExecutor` engine-lost path** — The test depends on the executor actually catching the resume error and branching to fresh execution. If the error handling changes, the test needs updating. Low risk — the path is stable.

## Migration Plan

No production code changes. All test files are net-new or additive extensions. No migration needed.

## Open Questions

_(none — all decisions made during design session)_
