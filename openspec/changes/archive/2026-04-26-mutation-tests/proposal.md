## Why

The project has 29 backend test files and 3 frontend test files, but no mechanism to measure whether those tests actually catch regressions. Tests can exist that pass on all current code yet fail to detect a significant class of bugs — mutation testing surfaces exactly this gap by injecting deliberate faults and checking that the test suite catches them.

## What Changes

- Add **Stryker** mutation testing for the backend (`src/bun/`) using the `command` test runner pointing at `bun test src/bun`
- Add **Vitest** as a second test runner for the frontend (`src/mainview/`) and use `@stryker-mutator/vitest-runner` to enable per-test coverage mapping
- Migrate the 3 existing frontend test files (`conversation.test.ts`, `pairToolMessages.test.ts`, `useCommandsCache.test.ts`) from `bun:test` to `vitest` (rewriting `mock.module` → `vi.mock`, `mock()` → `vi.fn()`)
- Add **two Stryker configs**: `stryker.backend.json` and `stryker.frontend.json`
- Add **GitHub Actions nightly workflow** (`mutation.yml`) running at 02:00 UTC, uploading HTML + JSON reports as artifacts
- Add `test:mutation`, `test:mutation:backend`, `test:mutation:frontend` npm scripts
- Scope mutation to source files that have test coverage only — untested files are excluded to avoid noise
- Fix the current test command gap: `bun test src/bun/test` misses `pipeline/batcher.test.ts` and `engine/__tests__/` — the Stryker command will use `bun test src/bun` instead

## Capabilities

### New Capabilities

- `mutation-testing`: Stryker-based mutation testing pipeline covering backend (bun:test command runner) and frontend (Vitest runner), with nightly GitHub Actions execution and HTML+JSON reporting
- `frontend-vitest`: Vitest test runner for `src/mainview/` enabling module-level mock isolation compatible with Stryker's vitest-runner integration

### Modified Capabilities

*(none — no existing spec-level requirements are changing)*

## Impact

**New devDependencies:**
- `@stryker-mutator/core` ^9.x
- `@stryker-mutator/typescript-checker` ^9.x
- `@stryker-mutator/vitest-runner` ^9.x
- `vitest` ^2.x

**New files:**
- `stryker.backend.json`
- `stryker.frontend.json`
- `vitest.config.ts`
- `.github/workflows/mutation.yml`

**Modified files:**
- `package.json` (new scripts + devDependencies)
- `src/mainview/stores/conversation.test.ts` (bun:test → vitest)
- `src/mainview/utils/pairToolMessages.test.ts` (bun:test → vitest)
- `src/mainview/composables/useCommandsCache.test.ts` (bun:test → vitest)

**No API or runtime behavior changes.** This is purely developer tooling — no production code is modified.

**Side effect:** Fixing `bun test src/bun/test` → `bun test src/bun` also causes `pipeline/batcher.test.ts` and `engine/__tests__/*.test.ts` to be picked up by the main test command going forward.
