## MODIFIED Requirements

### Requirement: Stryker backend mutation config exists
The project SHALL provide a `stryker.backend.json` configuration file at the project root that configures Stryker to mutate backend source files using the `vitest` test runner (via `@stryker-mutator/vitest-runner` with `vitest.backend.config.ts`). The vitest backend config SHALL alias `bun:sqlite` to a compatibility shim so Stryker can instrument and run tests in a Node.js context.

#### Scenario: Backend config is present and valid
- **WHEN** a developer runs `npx stryker run stryker.backend.json`
- **THEN** Stryker loads the config without errors and begins mutating `src/bun/` source files

#### Scenario: Backend config targets only tested source files
- **WHEN** the backend Stryker run completes
- **THEN** only files with corresponding test coverage appear in the mutation report (no untested files)

#### Scenario: Backend config uses vitest runner with perTest coverage
- **WHEN** Stryker evaluates each mutant
- **THEN** it uses `@stryker-mutator/vitest-runner` with `coverageAnalysis: "perTest"` and `vitest.backend.config.ts` as the config file

#### Scenario: Stryker dry-run passes without a pre-existing database
- **WHEN** Stryker executes its initial dry-run test pass in a clean CI environment (no `~/.railyn/railyn.db`)
- **THEN** all tests in the dry-run pass — specifically, tests for `AnthropicProvider` and `retryStream` do not crash with `no such table: logs`
