## ADDED Requirements

### Requirement: Stryker backend mutation config exists
The project SHALL provide a `stryker.backend.json` configuration file at the project root that configures Stryker to mutate backend source files using the `command` test runner.

#### Scenario: Backend config is present and valid
- **WHEN** a developer runs `npx stryker run stryker.backend.json`
- **THEN** Stryker loads the config without errors and begins mutating `src/bun/` source files

#### Scenario: Backend config targets only tested source files
- **WHEN** the backend Stryker run completes
- **THEN** only files with corresponding test coverage appear in the mutation report (no untested files)

#### Scenario: Backend config uses bun test command runner
- **WHEN** Stryker evaluates each mutant
- **THEN** it runs `bun test src/bun --timeout 20000` as the test command

### Requirement: Stryker frontend mutation config exists
The project SHALL provide a `stryker.frontend.json` configuration file at the project root that configures Stryker to mutate frontend source files using the `vitest` test runner.

#### Scenario: Frontend config is present and valid
- **WHEN** a developer runs `npx stryker run stryker.frontend.json`
- **THEN** Stryker loads the config without errors and begins mutating `src/mainview/` source files

#### Scenario: Frontend config uses vitest runner
- **WHEN** Stryker evaluates each mutant
- **THEN** it uses `@stryker-mutator/vitest-runner` for test execution (not a command subprocess)

### Requirement: npm scripts for mutation testing
The project SHALL expose mutation testing via `package.json` scripts.

#### Scenario: Run backend mutation
- **WHEN** a developer runs `bun run test:mutation:backend`
- **THEN** Stryker runs with `stryker.backend.json` and exits non-zero only on internal error (no threshold enforced initially)

#### Scenario: Run frontend mutation
- **WHEN** a developer runs `bun run test:mutation:frontend`
- **THEN** Stryker runs with `stryker.frontend.json`

#### Scenario: Run all mutations
- **WHEN** a developer runs `bun run test:mutation`
- **THEN** both backend and frontend Stryker runs execute sequentially

### Requirement: HTML and JSON reports are produced
Each Stryker run SHALL produce both an HTML report and a JSON report.

#### Scenario: Reports written after backend run
- **WHEN** `test:mutation:backend` completes
- **THEN** `reports/mutation/backend/` contains `mutation.html` and `mutation.json`

#### Scenario: Reports written after frontend run
- **WHEN** `test:mutation:frontend` completes
- **THEN** `reports/mutation/frontend/` contains `mutation.html` and `mutation.json`

### Requirement: GitHub Actions nightly mutation workflow
The project SHALL include a `.github/workflows/mutation.yml` workflow that runs mutation tests on a nightly schedule.

#### Scenario: Workflow runs at 02:00 UTC nightly
- **WHEN** the cron schedule `0 2 * * *` fires
- **THEN** the workflow runs both `test:mutation:backend` and `test:mutation:frontend`

#### Scenario: Reports uploaded as workflow artifacts
- **WHEN** the nightly workflow completes (success or failure)
- **THEN** the HTML and JSON report directories are uploaded as GitHub Actions artifacts and retained for 30 days

#### Scenario: Workflow can be triggered manually
- **WHEN** a developer uses the GitHub Actions UI "Run workflow" button
- **THEN** the workflow runs immediately on the default branch

### Requirement: TypeScript checker validates mutants
The Stryker backend config SHALL use `@stryker-mutator/typescript-checker` to pre-validate mutants before running tests.

#### Scenario: Type-invalid mutants are skipped
- **WHEN** Stryker generates a mutant that produces a TypeScript type error
- **THEN** the mutant is marked as `CompileError` and not counted against the score

### Requirement: test command covers all bun test files
The `test` script in `package.json` SHALL cover all backend test files including those in subdirectories.

#### Scenario: Pipeline batcher tests are included
- **WHEN** a developer runs `bun run test`
- **THEN** `src/bun/pipeline/batcher.test.ts` is executed

#### Scenario: Engine __tests__ files are included
- **WHEN** a developer runs `bun run test`
- **THEN** `src/bun/engine/__tests__/tool-display.test.ts` and `src/bun/engine/__tests__/validation.test.ts` are executed
