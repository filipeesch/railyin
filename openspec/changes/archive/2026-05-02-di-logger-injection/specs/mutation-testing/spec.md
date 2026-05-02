## MODIFIED Requirements

### Requirement: Stryker backend mutation config exists
The project SHALL provide a `stryker.backend.json` configuration file at the project root that configures Stryker to mutate backend source files using the `vitest` test runner with `perTest` coverage analysis.

#### Scenario: Backend config is present and valid
- **WHEN** a developer runs `npx stryker run stryker.backend.json`
- **THEN** Stryker loads the config without errors and begins mutating `src/bun/` source files

#### Scenario: Backend config targets only tested source files
- **WHEN** the backend Stryker run completes
- **THEN** only files with corresponding test coverage appear in the mutation report (no untested files)

#### Scenario: Backend config uses vitest runner with perTest coverage
- **WHEN** Stryker evaluates each mutant
- **THEN** it uses `@stryker-mutator/vitest-runner` with `vitest.backend.config.ts` and `coverageAnalysis: "perTest"`

#### Scenario: Stryker dry-run passes with no test failures
- **WHEN** Stryker performs its initial dry-run before mutating
- **THEN** all tests in the `src/bun/test/` suite pass, including `providers.test.ts` and `retry.test.ts`
- **AND** no `no such table: logs` error is thrown
