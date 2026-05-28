# Async Worktree Test Suite — Design

## Context

The async worktree feature replaces synchronous `triggerWorktreeIfNeeded()` with async `prepareAndExecute()`. Testing this requires covering:
- Callback timing (onPrepared vs onFailed)
- Concurrent call protection (idempotency)
- State transitions (`preparing` → `running`/`failed`)
- UI reactivity to `"preparing"` badge

The existing test infrastructure is already solid:
- WorktreeManager uses DI — all dependencies are injectable
- `ApiMock` supports WebSocket push + timed responses
- In-memory SQLite DB for integration tests
- Real git repos for subprocess testing

## Goals

- Unit tests: Callback interface behavior (no real git needed)
- Integration tests: Handler-level async behavior with in-memory DB
- E2E tests: UI state transitions (`preparing` badge → streaming)
- Edge cases: Concurrent calls, server restart, task deletion during prep

## Non-Goals

- Network failure simulation
- Performance benchmarking
- UI visual regression tests

## Decisions

### 1. Three-Layer Test Structure
**Unit** → `prepareAndExecute()` callback behavior
**Integration** → Handler-level async state transitions
**E2E** → UI badge visibility + streaming

### 2. Callback Mocking
SPY on `IWorktreePreparerCallback` calls with `vi.fn()`. Validates behavior without needing real git/orchestrator.

### 3. Concurrent Call Testing
Track active preparations per taskId in DB. Verify only one worktree creation happens even under concurrent calls.

## Risks / Mitigations

| Risk | Mitigation |
|------|-----------|
| Non-deterministic timing | `vi.runAllTimers()` in unit; 15s timeout in integration |
| Real git slow in tests | Unit tests mock git; only integration spawns subprocess |
| Concurrent test interference | Unique task IDs per test; runner isolation |

## Edge Cases Covered

- Concurrent `prepareAndExecute()` calls → single worktree creation
- Server restart → resume from `"creating"` state
- Task deletion during prep → cancel in-flight work
- Timeout → auto-transition to `"failed"`
