## Why

The `fix-pi-chat-sessions` change adds three new constructor dependencies to `ChatExecutor` and a new pre-flight error path. Without an automated test suite, the fix can silently regress (the original bug was a silent failure) and the new paths remain unverified. This proposal defines the test coverage that validates and protects the fix.

## What Changes

- Add a new unit-test file `src/bun/test/chat-executor.test.ts` covering all `ChatExecutor` code paths — happy path, pre-flight error branch, and `boardTools` / `contextWindowOverride` injection
- Add a `seedChatSession()` helper to `src/bun/test/helpers.ts` (additive — no existing tests affected)
- Extend `src/bun/test/execution-params-builder.test.ts` with chat-session-specific parameter resolution cases
- Add two Playwright specs to `e2e/ui/chat-session-drawer.spec.ts`: Pi error message rendering and Claude happy-path continuity

## Capabilities

### New Capabilities
- `chat-executor-test`: Unit and integration test coverage for `ChatExecutor` — constructor injection, pre-flight guard, `ExecutionParams` construction, and `onNewMessage` callback invocation

### Modified Capabilities
_(none — no existing spec-level requirements change; test files are new additions)_

## Impact

- **New test files**: `src/bun/test/chat-executor.test.ts`, `e2e/ui/chat-session-drawer.spec.ts`
- **Extended test file**: `src/bun/test/helpers.ts` (additive `seedChatSession()` helper), `src/bun/test/execution-params-builder.test.ts` (new test cases)
- **No production code changes**
- **No RPC contract changes**
- **No DB schema changes**
