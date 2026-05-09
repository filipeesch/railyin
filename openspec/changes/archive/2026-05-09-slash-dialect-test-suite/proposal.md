## Why

The `slash-command-dialect` change introduces several new classes (`SlashCommandDialectRegistry`, `CopilotDialect`, `ClaudeDialect`, `NullDialect`) and refactors existing logic (migration of free functions into classes, removal of dead code in `TransitionExecutor`). Without a structured test suite, the refactoring risks silent regressions in existing slash-prompt behavior and leaves new dialect integration points untested. The test suite is defined as a separate proposal so implementation can proceed in parallel with coverage work.

## What Changes

- Delete `src/bun/test/slash-prompt.test.ts` — all 20+ scenarios migrate to `copilot-dialect.test.ts` under the new `CopilotDialect` class API
- Migrate `collectCopilotCommands` test cases from `src/bun/test/list-commands.test.ts` into `copilot-dialect.test.ts`
- Migrate `collectClaudeCommands` test cases from `src/bun/test/list-commands.test.ts` into `claude-dialect.test.ts`
- Create `src/bun/test/slash-command-dialect-registry.test.ts` — registry unit tests
- Create `src/bun/test/copilot-dialect.test.ts` — `CopilotDialect` unit tests (listing + resolution + XML wrapping)
- Create `src/bun/test/claude-dialect.test.ts` — `ClaudeDialect` unit tests (listing with subdirs + resolution without frontmatter strip + colon-path mapping)
- Create `src/bun/test/null-dialect.test.ts` — `NullDialect` unit tests (trivial passthrough)
- Extend `src/bun/test/engine-registry.test.ts` — tests for dialect wiring at construction time
- Extend `src/bun/test/pi-harness.test.ts` — `SpyDialect` injection tests verifying Pi delegates listing and resolution to its injected dialect
- Update `src/bun/test/transition-executor.test.ts` — update `displayText` assertion (now equals raw prompt, not expanded body); remove `resolvePrompt` filesystem setup
- Update `src/bun/test/copilot-rpc-scenarios.test.ts` — update slash-resolution scenario to assert XML-wrapped content is sent to the Copilot SDK

## Capabilities

### New Capabilities
- `slash-dialect-test-coverage`: Test coverage spec for all `SlashCommandDialect` implementations, the registry, Pi engine dialect integration, and all affected test file migrations

### Modified Capabilities
_(none — this change adds and migrates tests; no existing spec requirements change)_

## Impact

- **New test files**: `slash-command-dialect-registry.test.ts`, `copilot-dialect.test.ts`, `claude-dialect.test.ts`, `null-dialect.test.ts`
- **Deleted test files**: `slash-prompt.test.ts` (logic migrated)
- **Updated test files**: `list-commands.test.ts` (partial migration), `pi-harness.test.ts`, `transition-executor.test.ts`, `engine-registry.test.ts`, `copilot-rpc-scenarios.test.ts`
- **No production code changes** — all changes are in `src/bun/test/`
- **Depends on**: `slash-command-dialect` change being implemented first
