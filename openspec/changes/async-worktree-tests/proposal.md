# Async Worktree Test Suite

## Why

The async worktree change replaces synchronous `triggerWorktreeIfNeeded()` with asynchronous `prepareAndExecute()`. This architectural shift requires a comprehensive test suite covering async behavior, callback interfaces, state transitions, and edge cases.

## What Changes

- New test file: `worktree-preparation.test.ts` (unit tests for `prepareAndExecute()` + callback interface)
- Updated handler tests: Verify `tasks.ts` async behavior
- New E2E UI spec: `worktree-preparation.spec.ts` (simulates `"preparing"` → `"running"` badge transitions)
- Edge case coverage: concurrent calls, server restart, task deletion during preparation

## Capabilities

### New Capabilities
- `async-worktree-test-suite`: Comprehensive test coverage for async worktree preparation across unit, integration, and E2E layers

### Modified Capabilities
- `unit-tests`: Existing `worktree.test.ts` refactored to use new `prepareAndExecute()` API
- `integration-tests`: Handler tests cover async state transitions
- `e2e-tests`: New spec for `"preparing"` badge visibility, error handling, streaming start

## Impact

**Test files**: 1 new unit test file, 1 new E2E spec, updated handler tests (~5 files)
**Infrastructure**: No new testing infrastructure — leverages existing `ApiMock`, `vi.fn()` spies, and in-memory SQLite
**Mocks**: `IWorktreePreparerCallback` mock interface; `GitRepositoryManager` mock for unit tests
