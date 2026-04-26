## Context

The project uses `bun:test` for all backend tests (29 files in `src/bun/test/` plus 3 additional files in `src/bun/pipeline/` and `src/bun/engine/__tests__/`) and 3 frontend tests in `src/mainview/`. Tests pass today, but there is no mechanism to verify whether they actually catch regressions — a test can exist and pass yet be completely ineffective at detecting mutations of the code it covers.

Stryker is the dominant mutation testing tool for TypeScript. It works by generating many syntactic variants of source code (mutants) and checking if the test suite fails on each. Survivors are untested logic paths.

The key constraint is that `bun:test` has no native Stryker runner — Stryker's `command` runner bridges this by spawning `bun test` as a subprocess per mutant batch. For the frontend we'll use `@stryker-mutator/vitest-runner`, which requires migrating the 3 frontend test files from `bun:test` to Vitest.

## Goals / Non-Goals

**Goals:**
- Produce mutation scores for all source files that have existing test coverage
- Frontend mutation via Vitest runner (faster, per-test coverage mapping)
- Backend mutation via Stryker command runner pointing at `bun test src/bun`
- Nightly GitHub Actions workflow with HTML + JSON report artifacts
- `test:mutation`, `test:mutation:backend`, `test:mutation:frontend` npm scripts
- Fix existing gap: `bun test src/bun/test` misses files in `pipeline/` and `engine/__tests__/`

**Non-Goals:**
- Writing new tests to expand mutation scope (tracked separately as next step)
- Enforcing a mutation score threshold (baseline must be established first via the first nightly run)
- Mutating source files with zero test coverage (produces noise, not signal)
- Performance: mutation runs are inherently slow and run only on schedule

## Decisions

### D1: Vitest for frontend, command runner for backend

**Decision:** Use `@stryker-mutator/vitest-runner` for `src/mainview/` and `testRunner: "command"` for `src/bun/`.

**Why:** Vitest runner enables per-test coverage mapping — only the tests that `import` the mutated module are run per mutant, making frontend runs fast. The backend has no Stryker-native Bun runner, so the command runner (spawning `bun test src/bun`) is the only option. The backend test suite runs in ~5-10s, so command runner overhead is acceptable.

**Alternatives considered:**
- _Stryker command runner for both:_ Simpler setup, no Vitest dependency. Rejected because frontend tests run in ~1s anyway, but more importantly Vitest opens the door to per-test filtering and better DX over time.
- _Custom Bun mutation script:_ Full native speed. Rejected — would require building and maintaining a framework from scratch.

### D2: Migrate 3 frontend test files to Vitest

**Decision:** Rewrite `conversation.test.ts`, `pairToolMessages.test.ts`, `useCommandsCache.test.ts` replacing `bun:test` primitives with Vitest equivalents.

**Migration map:**
```
import { ... } from "bun:test"     →  import { ... } from "vitest"
mock(() => {})                      →  vi.fn(() => {})
mock.module("module", factory)      →  vi.mock("module", factory)
mock.restore()                      →  vi.restoreAllMocks()
apiMock.mock.calls                  →  apiMock.mock.calls  (same shape)
apiMock.mockImplementation(fn)      →  apiMock.mockImplementation(fn)  (same)
```

**Why not keep bun:test for frontend:** `@stryker-mutator/vitest-runner` integrates directly with Vitest's test runner API to inject mutants and collect coverage. It cannot run bun:test files.

### D3: Two separate Stryker configs

**Decision:** `stryker.backend.json` and `stryker.frontend.json` at project root.

**Why:** Backend and frontend have different test runners, different mutate globs, and different reporter paths. A single config would require complex conditional logic or become hard to read. Two configs are explicit and independently runnable.

### D4: Mutation scope = tested files only

**Decision:** Explicitly list only source files that have test coverage in the `mutate` array of each Stryker config.

**Backend files in scope (~34):** `src/bun/ai/retry.ts`, `src/bun/ai/anthropic.ts`, `src/bun/ai/openai-compatible.ts`, `src/bun/engine/lease-registry.ts`, `src/bun/engine/orchestrator.ts`, `src/bun/engine/claude/adapter.ts`, `src/bun/engine/claude/engine.ts`, `src/bun/engine/claude/events.ts`, `src/bun/engine/claude/tools.ts`, `src/bun/engine/copilot/engine.ts`, `src/bun/engine/copilot/events.ts`, `src/bun/engine/copilot/tools.ts`, `src/bun/engine/common-tools.ts`, `src/bun/engine/coordinator.ts`, `src/bun/engine/tool-display.ts`, `src/bun/engine/dialects/copilot-prompt-resolver.ts`, `src/bun/handlers/tasks.ts`, `src/bun/handlers/conversations.ts`, `src/bun/handlers/workflow.ts`, `src/bun/handlers/workspace.ts`, `src/bun/handlers/projects.ts`, `src/bun/handlers/chat-sessions.ts`, `src/bun/handlers/mcp.ts`, `src/bun/pipeline/batcher.ts`, `src/bun/workflow/tools.ts`, `src/bun/workflow/review.ts`, `src/bun/db/migrations.ts`, `src/bun/db/index.ts`, `src/bun/git/worktree.ts`, `src/bun/utils/resolve-file-attachments.ts`, `src/bun/utils/attachment-routing.ts`, `src/bun/conversation/context.ts`, `src/bun/config/index.ts`, `src/shared/stream-tree.ts`, `src/mainview/task-activity.ts`

**Frontend files in scope (3):** `src/mainview/stores/conversation.ts`, `src/mainview/utils/pairToolMessages.ts`, `src/mainview/composables/useCommandsCache.ts`

**Why:** Mutating a file with no tests produces 100% surviving mutants — this is expected and provides zero signal. Including such files would mask real test quality issues and require a very low threshold.

### D5: No threshold on first run — baseline first

**Decision:** Ship without a `thresholds` setting in Stryker configs. After the first nightly run establishes a baseline score, set the threshold to `baseline - 5`.

**Why:** Setting an arbitrary threshold before knowing the baseline risks the first run failing with no actionable fix. The first run's HTML report tells us the true score.

### D6: Fix `bun test src/bun/test` → `bun test src/bun`

**Decision:** Update the `test` script in `package.json` from `bun test src/bun/test` to `bun test src/bun`.

**Why:** Three test files currently escape the test command:
- `src/bun/pipeline/batcher.test.ts`
- `src/bun/engine/__tests__/tool-display.test.ts`
- `src/bun/engine/__tests__/validation.test.ts`

These are co-located with source or in `__tests__/` subdirectories. Changing to `src/bun` picks them all up. This is a correctness fix unrelated to mutation testing but discovered during scope analysis.

## Risks / Trade-offs

**[Risk] Backend mutation runs are slow** → The full `bun test src/bun` suite runs ~5-15s per mutant batch. With ~300-500 backend mutants, a full run could take 30-90 minutes. Mitigation: runs are nightly and non-blocking; no developer waits on them.

**[Risk] Vitest and bun:test behavioral differences** → Some test-specific behaviors (e.g., timing, module resolution) could behave differently under Vitest. Mitigation: run both `bun test src/mainview` and `vitest run` after migration to confirm same pass/fail status before removing bun from the frontend path.

**[Risk] Stryker TypeScript checker adds overhead** → The `typescript-checker` pre-validates mutants, discarding type-invalid ones before running tests. This saves test time but adds up-front TS compilation time per mutant. Mitigation: on nightly schedule, overhead is acceptable; can be disabled if too slow.

**[Risk] `src/bun/testing/mock-engine.ts` and `src/bun/ai/fake.ts` are production-path files but are test infrastructure** → They will appear as mutation candidates if covered by glob. Mitigation: explicitly exclude them from the `mutate` array since they are test helpers.

**[Trade-off] Two test runners for frontend** → Developers must know to run `bun test src/mainview` OR `npx vitest run` for frontend tests — not both simultaneously. Mitigation: document clearly in README/CONTRIBUTING; the `bun test` command won't pick up vitest-configured tests since they import from "vitest" not "bun:test".

## Open Questions

*(none — all key decisions resolved during discovery)*
