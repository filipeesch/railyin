## ADDED Requirements

### Requirement: Vitest is configured for frontend tests
The project SHALL include a `vitest.config.ts` at the project root that configures Vitest to run tests in `src/mainview/`.

#### Scenario: Vitest discovers frontend test files
- **WHEN** a developer runs `npx vitest run`
- **THEN** Vitest discovers and executes all `*.test.ts` files under `src/mainview/`

#### Scenario: Vitest config resolves path aliases
- **WHEN** a frontend test imports from `@shared/` or `@/`
- **THEN** Vitest resolves the alias correctly using the same mappings as `tsconfig.json`

### Requirement: Frontend test files use Vitest APIs
All three frontend test files SHALL use Vitest primitives instead of `bun:test` primitives.

#### Scenario: Imports come from vitest not bun:test
- **WHEN** `conversation.test.ts`, `pairToolMessages.test.ts`, or `useCommandsCache.test.ts` are opened
- **THEN** imports are from `"vitest"` (not `"bun:test"`)

#### Scenario: Module mocking uses vi.mock
- **WHEN** a frontend test mocks a module (e.g., `"../rpc"` or `"vue"`)
- **THEN** the mock uses `vi.mock(modulePath, factory)` syntax

#### Scenario: Function mocking uses vi.fn
- **WHEN** a frontend test creates a mock function
- **THEN** it uses `vi.fn()` (not `mock()`)

#### Scenario: Existing test assertions remain valid
- **WHEN** `npx vitest run` is executed
- **THEN** all previously passing tests in the 3 migrated files pass under Vitest with no behavior changes

### Requirement: Frontend bun:test path still works
The `bun test src/mainview` command MUST NOT break after the Vitest migration — tests importing from `"vitest"` will fail to run under bun:test, but no existing `bun test` command should regress for files that previously passed.

#### Scenario: bun test of backend is unaffected
- **WHEN** a developer runs `bun run test` (i.e., `bun test src/bun`)
- **THEN** all backend tests pass and no frontend test is picked up by this command
