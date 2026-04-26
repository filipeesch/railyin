## 1. Dependencies & Tooling Setup

- [x] 1.1 Add `@stryker-mutator/core`, `@stryker-mutator/typescript-checker`, `@stryker-mutator/vitest-runner`, and `vitest` to `devDependencies` in `package.json` and run `bun install`
- [x] 1.2 Fix `test` script in `package.json`: change `bun test src/bun/test` → `bun test src/bun --timeout 20000` so pipeline and engine __tests__ are included
- [x] 1.3 Verify `bun run test` still passes and now picks up `src/bun/pipeline/batcher.test.ts` and `src/bun/engine/__tests__/`

## 2. Vitest Configuration

- [x] 2.1 Create `vitest.config.ts` at project root, extending vite's resolve aliases (`@` → `src/mainview`, `@shared` → `src/shared`) and setting `include: ["src/mainview/**/*.test.ts"]`
- [x] 2.2 Run `npx vitest run --passWithNoTests` to confirm Vitest starts correctly before any test migration

## 3. Migrate Frontend Tests to Vitest

- [x] 3.1 Migrate `src/mainview/stores/conversation.test.ts`: replace `import ... from "bun:test"` → `"vitest"`, `mock()` → `vi.fn()`, `mock.module()` → `vi.mock()`
- [x] 3.2 Migrate `src/mainview/utils/pairToolMessages.test.ts`: replace `bun:test` imports with `vitest` equivalents
- [x] 3.3 Migrate `src/mainview/composables/useCommandsCache.test.ts`: replace `bun:test` imports, `mock.module("vue", ...)` → `vi.mock("vue", ...)`, `mock.restore()` → `vi.restoreAllMocks()`
- [x] 3.4 Run `npx vitest run` and confirm all 3 migrated test files pass with the same test count as before
- [x] 3.5 Confirm `bun run test` (backend) is unaffected — all backend tests still pass

## 4. Stryker Backend Config

- [x] 4.1 Create `stryker.backend.json` at project root with `testRunner: "command"`, command `"bun test src/bun --path-ignore-patterns '**/batcher.test.ts' --timeout 20000"`, `checkers: []`, `concurrency: 2`, `reporters: ["html", "json"]`, and `htmlReporter.fileName` pointing to `reports/mutation/backend/index.html`
- [x] 4.2 Set the `mutate` array in `stryker.backend.json` to the explicit list of ~34 tested source files (see design.md D4); exclude `src/bun/testing/mock-engine.ts` and `src/bun/ai/fake.ts`
- [x] 4.3 Run `npx stryker run stryker.backend.json --mutate "src/bun/engine/lease-registry.ts"` as smoke test — 73 mutants, 0 timeouts, reports generated

## 5. Stryker Frontend Config

- [x] 5.1 Create `stryker.frontend.json` at project root with `testRunner: "vitest"`, `reporters: ["html", "json"]`, `htmlReporter.fileName` pointing to `reports/mutation/frontend/index.html`
- [x] 5.2 Set the `mutate` array to the 3 frontend source files: `src/mainview/stores/conversation.ts`, `src/mainview/utils/pairToolMessages.ts`, `src/mainview/composables/useCommandsCache.ts`
- [x] 5.3 Run `npx stryker run stryker.frontend.json` — 523 mutants, 82.2% score, HTML + JSON reports generated

## 6. npm Scripts

- [x] 6.1 Add `"test:mutation:backend": "stryker run stryker.backend.json"` to `package.json` scripts
- [x] 6.2 Add `"test:mutation:frontend": "stryker run stryker.frontend.json"` to `package.json` scripts
- [x] 6.3 Add `"test:mutation": "bun run test:mutation:backend && bun run test:mutation:frontend"` to `package.json` scripts

## 7. GitHub Actions Workflow

- [x] 7.1 Create `.github/workflows/mutation.yml` with a `schedule: cron: "0 2 * * *"` trigger and a `workflow_dispatch` trigger for manual runs
- [x] 7.2 Add workflow steps: checkout, setup Bun, `bun install`, `bun run test:mutation:backend`, `bun run test:mutation:frontend`
- [x] 7.3 Add `actions/upload-artifact` step to upload `reports/mutation/` with `retention-days: 30` and `if: always()` so reports upload even on Stryker failure

## 8. Reports Directory & Gitignore

- [x] 8.1 Create `reports/mutation/backend/.gitkeep` and `reports/mutation/frontend/.gitkeep` so the directory structure exists in git
- [x] 8.2 Add `reports/mutation/**/*.html` and `reports/mutation/**/*.json` to `.gitignore` so generated reports are not committed

## 9. Verification

- [x] 9.1 Run `bun run test:mutation:frontend` locally — mutation report produced in `reports/mutation/frontend/` (82.2% score, 523 mutants)
- [x] 9.2 Run `npx stryker run stryker.backend.json --mutate "src/bun/engine/lease-registry.ts"` smoke test — backend pipeline works end-to-end (73 mutants, 0 timeouts)
- [x] 9.3 HTML reports generated for both frontend and backend; scores are non-zero
